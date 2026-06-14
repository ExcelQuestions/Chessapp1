"""
Blindfold Chess -- FastAPI backend
==================================

Holds the *true* board server-side and only ever sends the browser the pawn
positions. It deliberately does NOT send the player's legal moves (those would
leak where the hidden pieces are). The client submits a move; the server is the
sole authority that validates and applies it. That keeps the blindfold honest
even if a player inspects the network traffic.

Run (development):
    APP_PASSWORD=yourpassword uvicorn server:app --reload --port 8000
    # or: create a .env file (see .env.example) and uvicorn picks it up

Run (production via Render / Docker):
    Set APP_PASSWORD (and optionally APP_SECRET) as environment variables.

State is kept in memory (a dict of games). For real hosting you'd swap this for
Redis/Postgres keyed by game id -- the per-game logic here is unchanged.
"""

import hashlib
import hmac
import os
import secrets
import sys
import threading
import time
import uuid
from collections import defaultdict

# Load .env for local development; python-dotenv ships with uvicorn[standard].
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import chess
import chess.engine
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import blindfold_chess as bc  # reuse find_engine / format_move_list / build_pgn_game

ENGINE_PATH = bc.find_engine()

# Detect production: if the built SPA exists, FastAPI serves it from the same
# origin and no CORS headers are needed.
_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "dist")
_PRODUCTION = os.path.isdir(_DIST)

# --------------------------------------------------------------------------- #
# Authentication: a single shared password gates the whole app.
#
# APP_PASSWORD must be set as an environment variable — the server refuses to
# start without it so a forgotten config never silently uses a weak default.
# APP_SECRET can optionally be set to a fixed random string; if omitted it is
# derived from the password (still secure, just not independent).
# --------------------------------------------------------------------------- #
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
if not APP_PASSWORD:
    sys.exit(
        "\nERROR: APP_PASSWORD environment variable is not set.\n"
        "Set it before starting the server, e.g.:\n"
        "  APP_PASSWORD=mysecret uvicorn server:app --port 8000\n"
        "Or add APP_PASSWORD=... to a .env file (see .env.example).\n"
    )

_SECRET = os.environ.get("APP_SECRET") or hashlib.sha256(
    ("blindfold:" + APP_PASSWORD).encode()
).hexdigest()
_TOKEN = hmac.new(_SECRET.encode(), b"authenticated", hashlib.sha256).hexdigest()


def _password_ok(candidate: str) -> bool:
    return secrets.compare_digest(candidate or "", APP_PASSWORD)


def _token_ok(candidate: str) -> bool:
    return secrets.compare_digest(candidate or "", _TOKEN)


def require_auth(authorization: str = Header(default=""), token: str = "") -> None:
    """Allow the request through only with a valid bearer token, supplied either
    in the Authorization header or as a ?token= query param (used by the PGN
    download link, which can't set headers)."""
    bearer = authorization[7:] if authorization[:7].lower() == "bearer " else ""
    if _token_ok(bearer) or _token_ok(token):
        return
    raise HTTPException(401, "Authentication required.")


# --------------------------------------------------------------------------- #
# Rate limiting: simple in-memory sliding window, sufficient for a small
# number of users. Resets on server restart (acceptable trade-off).
# --------------------------------------------------------------------------- #
_login_attempts: dict = defaultdict(list)
_RATE_WINDOW = 60   # seconds
_RATE_LIMIT = 10    # max attempts per window per source IP


def _check_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window_start = now - _RATE_WINDOW
    recent = [t for t in _login_attempts[ip] if t > window_start]
    _login_attempts[ip] = recent
    if len(recent) >= _RATE_LIMIT:
        raise HTTPException(429, "Too many login attempts. Try again later.")
    _login_attempts[ip].append(now)


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #
# Disable the interactive docs endpoints — no need to expose the API schema.
app = FastAPI(title="Blindfold Chess", docs_url=None, redoc_url=None)

# CORS: in production the SPA is served from the same origin so no CORS headers
# are needed. In dev (Vite on :5173, API on :8000) allow localhost only.
if not _PRODUCTION:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

# Games: capped to prevent unbounded memory growth. When the cap is reached the
# oldest game is evicted — fine for a handful of concurrent users.
_games: dict = {}
_lock = threading.Lock()
_MAX_GAMES = 50

# Glimpse drills: memorise a position, then paint its territory map.
_drills: dict = {}
_MAX_DRILLS = 50


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #
class NewGame(BaseModel):
    level: int = Field(5, ge=0, le=20)
    colour: str = Field("white", pattern="^(white|black|random)$")
    think_time: float = Field(0.5, gt=0, le=5)
    show: str = Field("p", max_length=6)
    mode: str = Field("play", pattern="^(play|train|exo)$")
    pressure: bool = False


class MoveIn(BaseModel):
    move: str = Field(..., min_length=2, max_length=10)


class AnswerIn(BaseModel):
    """One field per answer format; the client sends whichever matches the
    pending question."""
    squares: list[str] | None = Field(None, max_length=16)
    yesno: bool | None = None
    count: int | None = Field(None, ge=0, le=16)
    paint: dict[str, str] | None = Field(None, max_length=64)


class NewDrill(BaseModel):
    colour: str = Field("random", pattern="^(white|black|random)$")
    seconds: int = Field(30, ge=3, le=120)
    level: int = Field(10, ge=0, le=20)


class PaintIn(BaseModel):
    """User's painted territory map: square name -> 'y' | 't' | 'c'."""
    paint: dict[str, str] = Field(..., max_length=64)


class Login(BaseModel):
    password: str = Field(..., max_length=200)


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


# --------------------------------------------------------------------------- #
# Pressure / territory map: every square gets an owner and an intensity, based
# on static exchange evaluation (the swap algorithm, cheapest captor first).
# This is what makes a pawn the ideal defender and a queen a poor one — the
# maths of the capture sequence, not hand-tuned weights. v1 limitations:
# no x-ray attackers (batteries undercount) and no pin awareness.
# --------------------------------------------------------------------------- #
_VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
        chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}


def _attacker_vals(board, color, sq):
    """Ascending piece values of `color`'s attackers of `sq`."""
    return sorted(_VAL[board.piece_at(a).piece_type]
                  for a in board.attackers(color, sq))


_KING_VAL = _VAL[chess.KING]


def _exchange(target_val, attackers, defenders):
    """Material won by the side of `attackers` initiating captures on a piece
    worth `target_val`, both sides swapping cheapest-first and free to stop
    (stand pat) whenever continuing loses material.

    A king may only capture when the opponent has no attacker left to answer:
    capturing into a square the opponent still covers would be moving into
    check, which is illegal. So if the cheapest remaining captor is the king
    and the other side can still recapture, this side simply cannot continue."""
    if not attackers:
        return 0
    if attackers[0] == _KING_VAL and defenders:
        return 0
    return max(0, target_val - _exchange(attackers[0], defenders, attackers[1:]))


def _bucket(pawns):
    return 1 if pawns <= 1 else 2 if pawns == 2 else 3


def _cover_strength(cheapest_val):
    """Claim quality on an empty square: pawn cover is permanent, queen cover
    evaporates the moment it's challenged."""
    return 3 if cheapest_val == 1 else 2 if cheapest_val <= 3 else 1


def _square_pressure(board, sq, human):
    """(owner, intensity) for one square, owner relative to the human player:
    'y' yours, 't' theirs, 'c' contested, or None for neutral."""
    engine = not human
    yours = _attacker_vals(board, human, sq)
    theirs = _attacker_vals(board, engine, sq)
    piece = board.piece_at(sq)

    if piece is None:
        if not yours and not theirs:
            return None

        def lands_safely(vals, opp_vals):
            """Can this side's cheapest attacker sit on the square without
            losing material? (The lander stops covering the square itself.)"""
            if not vals:
                return False
            rest = list(vals)
            lander = rest.pop(0)
            return _exchange(lander, list(opp_vals), rest) == 0

        y_safe = lands_safely(yours, theirs)
        t_safe = lands_safely(theirs, yours)
        if y_safe and not t_safe:
            return ("y", _cover_strength(yours[0]))
        if t_safe and not y_safe:
            return ("t", _cover_strength(theirs[0]))
        if y_safe and t_safe:
            return ("c", 1)
        # Neither side can land: ownership by denial — the cheaper coverer
        # holds the square (an enemy pawn's coverage beats your rook's).
        if yours and not theirs:
            return ("y", _cover_strength(yours[0]))
        if theirs and not yours:
            return ("t", _cover_strength(theirs[0]))
        if yours[0] != theirs[0]:
            if yours[0] < theirs[0]:
                return ("y", _cover_strength(yours[0]))
            return ("t", _cover_strength(theirs[0]))
        return ("c", 1)

    mine = piece.color == human
    if piece.piece_type == chess.KING:
        # Exchange maths is meaningless for kings (check, not capture).
        return ("y" if mine else "t", 1)

    occ_val = _VAL[piece.piece_type]
    captors = theirs if mine else yours
    defenders = yours if mine else theirs
    if not captors:
        return ("y" if mine else "t", 1)
    # Net result of the best capture sequence, unclamped: positive means the
    # captors profit, zero is a dead-equal trade, negative means the capture
    # fails — and by how much.
    forced = occ_val - _exchange(captors[0], list(defenders), list(captors[1:]))
    if forced > 0:
        return ("t" if mine else "y", _bucket(forced))
    if forced == 0:
        inten = 1 if occ_val == 1 else 2 if occ_val == 3 else 3
        return ("c", inten)
    return ("y" if mine else "t", _bucket(-forced))


def _pressure_map(board, human, occupied_only=False):
    out = {}
    for sq in chess.SQUARES:
        if occupied_only and board.piece_at(sq) is None:
            continue
        r = _square_pressure(board, sq, human)
        if r:
            out[chess.square_name(sq)] = {"o": r[0], "i": r[1]}
    return out


# --------------------------------------------------------------------------- #
# Exoskeleton: full blindfold, but the legal moves of every piece are shown as
# arrows. You read the position from its mobility instead of its pieces.
# --------------------------------------------------------------------------- #
def _move_arrows(board, human):
    """Every piece's available moves as {from, to, side}: 'y' for the human's
    pieces, 't' for the engine's. Both sides are sent; the client filters.
    Promotions collapse to a single arrow per from/to."""
    seen = set()
    arrows = []

    def add(moves, color):
        side = "y" if color == human else "t"
        for m in moves:
            key = (m.from_square, m.to_square, side)
            if key in seen:
                continue
            seen.add(key)
            arrows.append({
                "from": chess.square_name(m.from_square),
                "to": chess.square_name(m.to_square),
                "side": side,
            })

    add(board.legal_moves, board.turn)
    # The side not to move has no "legal" moves; a null move flips the turn so
    # we can read theirs too. Illegal while in check, so skip it then.
    if not board.is_check():
        board.push(chess.Move.null())
        try:
            add(board.legal_moves, board.turn)
        finally:
            board.pop()
    return arrows


# --------------------------------------------------------------------------- #
# Relation training: quiz questions generated from the attack graph.
# The truth never leaves the server, so answering is the only way to find out.
# --------------------------------------------------------------------------- #
_CENTER = [chess.parse_square(n) for n in (
    "c3", "d3", "e3", "f3", "c4", "d4", "e4", "f4",
    "c5", "d5", "e5", "f5", "c6", "d6", "e6", "f6",
)]


def _squares_q(qtype, text, squares):
    return {"type": qtype, "format": "squares", "text": text,
            "truth": sorted(chess.square_name(s) for s in squares)}


def _yesno_q(qtype, text, truth):
    return {"type": qtype, "format": "yesno", "text": text, "truth": bool(truth)}


def _count_q(qtype, text, truth):
    return {"type": qtype, "format": "count", "text": text, "truth": int(truth)}


def _gen_question(g):
    """Pick the next quiz question, salience first: newly hanging pieces, then
    threats from the engine's last move, then pins, then random coverage.
    A question identical to the previous one (same type and truth) is skipped
    so a piece that stays hanging doesn't get asked about every move."""
    import random
    board, human = g["board"], g["human"]
    engine = not human

    # Every 5th question is a paint round: reproduce the whole territory map
    # from memory. Scored by percentage agreement; feedback stays score-only
    # so the blindfold holds.
    if g["score"]["asked"] % 5 == 4:
        return {"type": "paint", "format": "paint",
                "text": "Paint the territory map: who owns each square right now?",
                "truth": _pressure_map(board, human)}

    own = {sq for sq, p in board.piece_map().items() if p.color == human}
    own_nonking = [sq for sq in own
                   if board.piece_at(sq).piece_type != chess.KING]

    hanging = [sq for sq in own_nonking
               if board.attackers(engine, sq) and not board.attackers(human, sq)]
    pinned = [sq for sq in own_nonking if board.is_pinned(human, sq)]

    salient = []
    if hanging:
        salient.append(_squares_q(
            "hanging",
            "Which of your pieces are attacked and undefended right now?",
            hanging))
    last = g.get("last_engine")
    if last:
        to_sq = chess.parse_square(last["uci"][2:4])
        hits = [sq for sq in board.attacks(to_sq) if sq in own]
        if hits:
            salient.append(_squares_q(
                "threat",
                f"Stockfish just played {last['san']}. "
                "Which of your pieces does that piece now attack?",
                hits))
    if pinned:
        salient.append(_yesno_q(
            "pin", "Is at least one of your pieces pinned to your king?", True))

    coverage = []
    if own_nonking:
        sq = random.choice(own_nonking)
        piece = board.piece_at(sq)
        coverage.append(_yesno_q(
            "defended",
            f"Is your {chess.piece_name(piece.piece_type)} on "
            f"{chess.square_name(sq)} defended by another of your pieces?",
            bool(board.attackers(human, sq))))
    sq = random.choice(_CENTER)
    coverage.append(_count_q(
        "count",
        f"How many of Stockfish's pieces attack the square {chess.square_name(sq)}?",
        len(board.attackers(engine, sq))))
    sq = random.choice(_CENTER)
    coverage.append(_squares_q(
        "attackers",
        f"Which of your pieces attack the square {chess.square_name(sq)}?",
        board.attackers(human, sq)))
    coverage.append(_squares_q(
        "hanging",
        "Which of your pieces are attacked and undefended right now?",
        hanging))
    coverage.append(_yesno_q(
        "pin", "Is at least one of your pieces pinned to your king?",
        bool(pinned)))

    prev = g.get("prev_question")
    for q in salient + [random.choice(coverage)]:
        if not prev or (q["type"], q["truth"]) != (prev["type"], prev["truth"]):
            return q
    return random.choice(coverage)


def _check_answer(q, body):
    if q["format"] == "squares":
        try:
            got = sorted({chess.square_name(chess.parse_square(s.strip().lower()))
                          for s in (body.squares or [])})
        except ValueError:
            return False
        return got == q["truth"]
    if q["format"] == "yesno":
        return body.yesno is not None and body.yesno == q["truth"]
    return body.count is not None and body.count == q["truth"]


def _state(game_id, show="p", pressure=False):
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

    out = {
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
    if g.get("mode") == "train":
        q = g.get("question")
        out["mode"] = "train"
        # Send only the question itself — never the truth.
        out["question"] = ({"text": q["text"], "format": q["format"]}
                           if q and not over else None)
        out["score"] = g["score"]
    # The overlay is suppressed while a quiz question is pending — it would
    # answer "which of your pieces are hanging?" at a glance.
    if pressure and not (g.get("mode") == "train" and g.get("question") and not over):
        out["pressure"] = _pressure_map(board, g["human"])
    if g.get("mode") == "exo":
        out["mode"] = "exo"
        out["arrows"] = [] if over else _move_arrows(board, g["human"])
    return out


def _do_engine_reply(g):
    """If it's the engine's turn and the game is live, make its move."""
    board = g["board"]
    if board.is_game_over(claim_draw=True) or board.turn == g["human"]:
        return
    move = _engine_best_move(board, g["level"], g["think_time"])
    san = board.san(move)
    board.push(move)
    g["last_engine"] = {"uci": move.uci(), "san": san}
    # Training mode: each engine reply is followed by a quiz question, which
    # must be answered before the next human move is accepted.
    if g.get("mode") == "train" and not board.is_game_over(claim_draw=True):
        g["question"] = _gen_question(g)


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
    # Left unauthenticated so load balancers / uptime checks can reach it.
    return {"ok": ENGINE_PATH is not None}


@app.post("/api/login")
def login(body: Login, request: Request):
    _check_rate_limit(request)
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
        if len(_games) >= _MAX_GAMES:
            # Evict the oldest game to keep memory bounded.
            oldest = next(iter(_games))
            del _games[oldest]
        _games[game_id] = {
            "board": chess.Board(),
            "human": human,
            "level": body.level,
            "think_time": body.think_time,
            "last_engine": None,
            "mode": body.mode,
            "question": None,
            "prev_question": None,
            "score": {"asked": 0, "correct": 0, "streak": 0, "best": 0,
                      "types": {}},
        }
        # If the human is Black, Stockfish (White) opens.
        _do_engine_reply(_games[game_id])
        return _state(game_id, body.show, body.pressure)


@app.get("/api/games/{game_id}")
def get_game(game_id: str, show: str = "p", pressure: int = 0,
             _=Depends(require_auth)):
    with _lock:
        if game_id not in _games:
            raise HTTPException(404, "No such game.")
        return _state(game_id, show, bool(pressure))


@app.post("/api/games/{game_id}/move")
def make_move(game_id: str, body: MoveIn, show: str = "p", pressure: int = 0,
              _=Depends(require_auth)):
    with _lock:
        if game_id not in _games:
            raise HTTPException(404, "No such game.")
        g = _games[game_id]
        board = g["board"]

        if board.is_game_over(claim_draw=True):
            raise HTTPException(409, "Game is already over.")
        if board.turn != g["human"]:
            raise HTTPException(409, "It is not your turn.")
        if g.get("question"):
            raise HTTPException(409, "Answer the training question first.")

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
        return _state(game_id, show, bool(pressure))


@app.post("/api/games/{game_id}/answer")
def answer_question(game_id: str, body: AnswerIn, show: str = "p",
                    pressure: int = 0, _=Depends(require_auth)):
    with _lock:
        if game_id not in _games:
            raise HTTPException(404, "No such game.")
        g = _games[game_id]
        q = g.get("question")
        if not q:
            raise HTTPException(409, "No question is pending.")

        extra = {}
        if q["format"] == "paint":
            # Pass mark 80% — feedback is the percentage only, never the map.
            pscore, _ = _paint_score(q["truth"], _norm_paint(body.paint or {}))
            correct = pscore["pct"] >= 80
            extra["pct"] = pscore["pct"]
        else:
            correct = _check_answer(q, body)

        s = g["score"]
        s["asked"] += 1
        s["correct"] += int(correct)
        s["streak"] = s["streak"] + 1 if correct else 0
        s["best"] = max(s["best"], s["streak"])
        t = s["types"].setdefault(q["type"], {"asked": 0, "correct": 0})
        t["asked"] += 1
        t["correct"] += int(correct)

        g["prev_question"] = q
        g["question"] = None

        return {**_state(game_id, show, bool(pressure)),
                "answered": {"correct": correct, **extra}}


# --------------------------------------------------------------------------- #
# Glimpse drills: the de Groot recall experiment, upgraded to relations.
# A plausible position is generated, shown briefly, then hidden; the user
# paints who owns each square from memory and is diffed against the real
# territory map. Truly random positions would defeat the point (no structure
# to chunk), so positions come from a few random opening plies followed by
# engine self-play — varied, but always chess-shaped.
# --------------------------------------------------------------------------- #
def _norm_paint(raw):
    """Validate and canonicalise a painted map: square name -> y/t/c."""
    paint = {}
    for k, v in raw.items():
        try:
            sq = chess.square_name(chess.parse_square(k.strip().lower()))
        except ValueError:
            raise HTTPException(422, f"Bad square name: {k}")
        if v not in ("y", "t", "c"):
            raise HTTPException(422, f"Bad owner (use y/t/c): {v}")
        paint[sq] = v
    return paint


def _paint_score(truth, paint):
    """Diff a painted map against the true territory map (ownership only,
    intensity isn't tested). Judged set = every square either map names, so
    painting nothing scores zero rather than 'no mistakes'."""
    judged = set(truth) | set(paint)
    wrong = sorted(sq for sq in judged
                   if paint.get(sq) != (truth[sq]["o"] if sq in truth else None))
    right = len(judged) - len(wrong)
    missed = sum(1 for sq in wrong if sq in truth)
    score = {
        "pct": round(100 * right / len(judged)) if judged else 100,
        "right": right,
        "wrong": len(wrong),
        "missed": missed,
        "phantom": len(wrong) - missed,
    }
    return score, wrong


def _drill_position(level):
    """A middlegame-ish position: random opening plies for variety, then
    Stockfish (one engine session) plays both sides at the given skill."""
    import random
    board = chess.Board()
    for _ in range(random.randint(4, 8)):
        moves = list(board.legal_moves)
        if not moves:
            break
        board.push(random.choice(moves))

    plies = random.randint(10, 36)
    engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)
    try:
        try:
            engine.configure({"Threads": 1, "Skill Level": level})
        except chess.engine.EngineError:
            pass
        for _ in range(plies):
            if board.is_game_over(claim_draw=True):
                break
            board.push(engine.play(board, chess.engine.Limit(time=0.02)).move)
    finally:
        engine.quit()

    # Never hand out a finished position.
    while board.move_stack and board.is_game_over(claim_draw=True):
        board.pop()
    return board


@app.post("/api/drills")
def create_drill(body: NewDrill, _=Depends(require_auth)):
    if ENGINE_PATH is None:
        raise HTTPException(503, "Stockfish engine not found on the server.")

    import random
    if body.colour == "random":
        human = random.choice([chess.WHITE, chess.BLACK])
    else:
        human = chess.WHITE if body.colour == "white" else chess.BLACK

    board = _drill_position(body.level)  # engine playout outside the lock
    drill_id = uuid.uuid4().hex[:12]
    with _lock:
        if len(_drills) >= _MAX_DRILLS:
            del _drills[next(iter(_drills))]
        _drills[drill_id] = {
            "board": board,
            "human": human,
            # Occupied squares only: the recall target is the pieces and each
            # one's status (yours-safe / theirs / hanging), which is what chess
            # memory is actually built from — not a uniform survey of every
            # empty square's control.
            "truth": _pressure_map(board, human, occupied_only=True),
            "done": False,
        }
    return {
        "drill_id": drill_id,
        "cells": _visible_map(board, ALL_TYPES),  # everything, for the glimpse
        "human_color": "w" if human == chess.WHITE else "b",
        "reveal_seconds": body.seconds,
    }


@app.post("/api/drills/{drill_id}/paint")
def paint_drill(drill_id: str, body: PaintIn, _=Depends(require_auth)):
    with _lock:
        if drill_id not in _drills:
            raise HTTPException(404, "No such drill.")
        d = _drills[drill_id]
        if d["done"]:
            raise HTTPException(409, "This drill has already been answered.")

        score, wrong = _paint_score(d["truth"], _norm_paint(body.paint))

        d["done"] = True
        return {
            "score": score,
            "wrong": wrong,
            "truth": d["truth"],
            "cells": _visible_map(d["board"], ALL_TYPES),
            "human_color": "w" if d["human"] == chess.WHITE else "b",
        }


@app.get("/api/games/{game_id}/pressure/{square}")
def pressure_detail(game_id: str, square: str, _=Depends(require_auth)):
    """Tap-for-detail: attacker counts and the exchange verdict for one square.
    Finer-grained than the bucketed overlay, so it gets the same quiz gating."""
    with _lock:
        if game_id not in _games:
            raise HTTPException(404, "No such game.")
        g = _games[game_id]
        if g.get("mode") == "train" and g.get("question"):
            raise HTTPException(409, "Answer the training question first.")
        try:
            sq = chess.parse_square(square.strip().lower())
        except ValueError:
            raise HTTPException(422, "Bad square name.")

        board, human = g["board"], g["human"]
        yours = _attacker_vals(board, human, sq)
        theirs = _attacker_vals(board, not human, sq)
        info = {"square": chess.square_name(sq),
                "your_attackers": len(yours),
                "their_attackers": len(theirs)}

        piece = board.piece_at(sq)
        if piece and piece.piece_type != chess.KING:
            mine = piece.color == human
            occ_val = _VAL[piece.piece_type]
            captors = theirs if mine else yours
            defenders = yours if mine else theirs
            if not captors:
                info["verdict"] = "Occupied; not attacked."
            else:
                forced = occ_val - _exchange(captors[0], list(defenders),
                                             list(captors[1:]))
                who = "them" if mine else "you"
                if forced > 0:
                    info["verdict"] = (f"Capturing here wins {who} {forced} "
                                       f"pawn{'s' if forced != 1 else ''}.")
                elif forced == 0:
                    info["verdict"] = "A capture here is a dead-equal exchange."
                else:
                    info["verdict"] = (f"Capturing here would lose {who} "
                                       f"{-forced} pawn{'s' if forced != -1 else ''}.")
        return info


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
if _PRODUCTION:
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="static")
