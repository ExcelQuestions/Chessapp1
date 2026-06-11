"""
Blindfold Chess -- FastAPI backend
==================================

Holds the *true* board server-side and only ever sends the browser the pawn
positions. It deliberately does NOT send the player's legal moves (those would
leak where the hidden pieces are). The client submits a move; the server is the
sole authority that validates and applies it. That keeps the blindfold honest
even if a player inspects the network traffic.

Run:
    python -m uvicorn server:app --reload --port 8000

State is kept in memory (a dict of games). For real hosting you'd swap this for
Redis/Postgres keyed by game id -- the per-game logic here is unchanged.
"""

import hashlib
import hmac
import os
import secrets
import sys
import threading
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import chess
import chess.engine
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import blindfold_chess as bc  # reuse find_engine / format_move_list / build_pgn_game

ENGINE_PATH = bc.find_engine()


# --------------------------------------------------------------------------- #
# Authentication: a single shared password gates the whole app.
#
# The password is read from APP_PASSWORD (falling back to a default so it works
# out of the box). Logging in exchanges the password for a bearer token that
# the client sends on every request. The token is a stateless HMAC, so it stays
# valid across restarts and across multiple server instances without any shared
# session store.
#
# NOTE: the default password below is committed to the repo, so for any real
# deployment set APP_PASSWORD (and ideally APP_SECRET) to your own secrets.
# --------------------------------------------------------------------------- #
APP_PASSWORD = os.environ.get("APP_PASSWORD", "adampaultom")
_SECRET = os.environ.get("APP_SECRET") or hashlib.sha256(
    ("blindfold:" + APP_PASSWORD).encode()
).hexdigest()
_TOKEN = hmac.new(_SECRET.encode(), b"authenticated", hashlib.sha256).hexdigest()


def _password_ok(candidate):
    return secrets.compare_digest(candidate or "", APP_PASSWORD)


def _token_ok(candidate):
    return secrets.compare_digest(candidate or "", _TOKEN)


def require_auth(authorization: str = Header(default=""), token: str = ""):
    """Allow the request through only with a valid bearer token, supplied either
    in the Authorization header or as a ?token= query param (used by the PGN
    download link, which can't set headers)."""
    bearer = authorization[7:] if authorization[:7].lower() == "bearer " else ""
    if _token_ok(bearer) or _token_ok(token):
        return
    raise HTTPException(401, "Authentication required.")

app = FastAPI(title="Blindfold Chess")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# game_id -> {board, human (chess colour), level, think_time, last_engine}
_games = {}
_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #
class NewGame(BaseModel):
    level: int = Field(5, ge=0, le=20)
    colour: str = Field("white", pattern="^(white|black|random)$")
    think_time: float = Field(0.5, gt=0, le=5)
    show: str = "p"  # which piece types are visible (subset of pnbrqk)


class MoveIn(BaseModel):
    move: str  # standard algebraic notation (Nf3, exd5, O-O, e8=Q) or coordinates


class Login(BaseModel):
    password: str


# --------------------------------------------------------------------------- #
# Engine: spawn per move, single thread, then quit (stateless & leak-free)
# --------------------------------------------------------------------------- #
def _engine_best_move(board, level, think_time):
    engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)
    try:
        try:
            engine.configure({"Threads": 1, "Skill Level": level})
        except chess.engine.EngineError:
            pass
        return engine.play(board, chess.engine.Limit(time=think_time)).move
    finally:
        engine.quit()


# --------------------------------------------------------------------------- #
# Blindfold view: pawns only, never the hidden pieces
# --------------------------------------------------------------------------- #
def _parse_move(board, text):
    """Resolve a move from standard algebraic notation (Nf3, exd5, O-O, e8=Q)
    or, as a fallback, coordinate notation (e2e4). Returns a chess.Move whose
    legality is still checked by the caller, or None if it can't be read."""
    text = text.strip()
    try:
        return board.parse_san(text)  # also validates legality for SAN
    except ValueError:
        pass
    try:
        return chess.Move.from_uci(text.lower())
    except ValueError:
        return None


ALL_TYPES = "pnbrqk"  # pawn, knight, bishop, rook, queen, king


def _clean_show(show):
    """Sanitise a visibility spec to the subset of piece-type letters we allow,
    in canonical order. Anything outside p/n/b/r/q/k is dropped."""
    chosen = set((show or "").lower()) & set(ALL_TYPES)
    return "".join(t for t in ALL_TYPES if t in chosen)


def _visible_map(board, show):
    """Square -> piece letter (P N B R Q K, lower for Black) for only the piece
    types in `show`. The server never sends pieces the player has hidden, so
    the blindfold stays honest however it's configured."""
    visible = set(_clean_show(show))
    return {
        chess.square_name(sq): piece.symbol()
        for sq, piece in board.piece_map().items()
        if piece.symbol().lower() in visible
    }


def _state(game_id, show="p"):
    g = _games[game_id]
    board = g["board"]
    outcome = board.outcome(claim_draw=True)
    over = outcome is not None

    status, result_text = "in_progress", None
    if over:
        if outcome.winner is None:
            status = "draw"
            reason = outcome.termination.name.replace("_", " ").title()
            result_text = f"Draw ({reason})"
        else:
            won = outcome.winner == g["human"]
            reason = outcome.termination.name.replace("_", " ").title()
            status = "you_win" if won else "engine_win"
            result_text = ("You win" if won else "Stockfish wins") + f" by {reason}"

    return {
        "game_id": game_id,
        "cells": _visible_map(board, show),
        "show": _clean_show(show),
        "human_color": "w" if g["human"] == chess.WHITE else "b",
        "turn": "none" if over else ("human" if board.turn == g["human"] else "engine"),
        "in_check": board.is_check() and not over,
        "game_over": over,
        "status": status,
        "result_text": result_text,
        "history": bc.format_move_list(board),
        "last_engine_move": g.get("last_engine"),
        "level": g["level"],
        "move_count": len(board.move_stack),
    }


def _do_engine_reply(g):
    """If it's the engine's turn and the game is live, make its move."""
    board = g["board"]
    if board.is_game_over(claim_draw=True) or board.turn == g["human"]:
        return
    move = _engine_best_move(board, g["level"], g["think_time"])
    san = board.san(move)
    board.push(move)
    g["last_engine"] = {"uci": move.uci(), "san": san}


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
    # Left unauthenticated so load balancers / uptime checks can reach it.
    return {"ok": ENGINE_PATH is not None}


@app.post("/api/login")
def login(body: Login):
    if not _password_ok(body.password):
        raise HTTPException(401, "Wrong password.")
    return {"token": _TOKEN}


@app.post("/api/games")
def create_game(body: NewGame, _=Depends(require_auth)):
    if ENGINE_PATH is None:
        raise HTTPException(503, "Stockfish engine not found on the server.")

    import random
    if body.colour == "random":
        human = random.choice([chess.WHITE, chess.BLACK])
    else:
        human = chess.WHITE if body.colour == "white" else chess.BLACK

    game_id = uuid.uuid4().hex[:12]
    with _lock:
        _games[game_id] = {
            "board": chess.Board(),
            "human": human,
            "level": body.level,
            "think_time": body.think_time,
            "last_engine": None,
        }
        # If the human is Black, Stockfish (White) opens.
        _do_engine_reply(_games[game_id])
        return _state(game_id, body.show)


@app.get("/api/games/{game_id}")
def get_game(game_id: str, show: str = "p", _=Depends(require_auth)):
    with _lock:
        if game_id not in _games:
            raise HTTPException(404, "No such game.")
        return _state(game_id, show)


@app.post("/api/games/{game_id}/move")
def make_move(game_id: str, body: MoveIn, show: str = "p", _=Depends(require_auth)):
    with _lock:
        if game_id not in _games:
            raise HTTPException(404, "No such game.")
        g = _games[game_id]
        board = g["board"]

        if board.is_game_over(claim_draw=True):
            raise HTTPException(409, "Game is already over.")
        if board.turn != g["human"]:
            raise HTTPException(409, "It is not your turn.")

        move = _parse_move(board, body.move)
        if move is None:
            raise HTTPException(
                422,
                "Couldn't read that move. Use standard notation like Nf3, exd5, "
                "O-O, e8=Q (coordinates such as e2e4 also work).",
            )
        if move not in board.legal_moves:
            raise HTTPException(422, "Illegal move.")

        board.push(move)
        _do_engine_reply(g)
        return _state(game_id, show)


@app.get("/api/games/{game_id}/pgn", response_class=PlainTextResponse)
def get_pgn(game_id: str, _=Depends(require_auth)):
    with _lock:
        if game_id not in _games:
            raise HTTPException(404, "No such game.")
        g = _games[game_id]
        game = bc.build_pgn_game(g["board"], g["human"], g["level"])
        return str(game)


# --------------------------------------------------------------------------- #
# Serve the built React app (production). Mounted last so /api/* wins. In dev
# you run Vite separately, so dist/ won't exist and this is simply skipped.
# The SPA shell is public; the login screen lives inside it and every API call
# it makes is gated by require_auth.
# --------------------------------------------------------------------------- #
_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "dist")
if os.path.isdir(_DIST):
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="static")
