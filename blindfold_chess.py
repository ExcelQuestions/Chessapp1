"""
Blindfold Chess vs Stockfish
=============================

Play chess against the Stockfish engine with a twist: it's blindfold chess.
Only pawns are ever shown on the board -- every other piece is hidden, so you
must track the position of your knights, bishops, rooks, queen and king in your
head.

Moves are entered in coordinate notation, e.g. e2e4, g8f6, e1g1 (castling),
e7e8q (promotion).

Requirements
------------
- python-chess  (pip install chess)   -- already handled by the setup
- A Stockfish binary on your machine.  Download from https://stockfishchess.org
  and either:
    * put it on your PATH, or
    * set the STOCKFISH_PATH environment variable, or
    * pass --engine "C:\\path\\to\\stockfish.exe"

Usage
-----
    python blindfold_chess.py
    python blindfold_chess.py --level 5 --colour white
    python blindfold_chess.py --level 20 --colour random --engine C:\\tools\\stockfish.exe

In-game commands
----------------
    <move>   make a move in coordinate notation (e.g. e2e4)
    board    redraw the board (pawns only)
    moves    list your legal moves
    resign   resign the game
    quit     exit immediately
"""

import argparse
import datetime
import os
import random
import shutil
import sys

import chess
import chess.engine
import chess.pgn


# --------------------------------------------------------------------------- #
# Engine discovery
# --------------------------------------------------------------------------- #
def find_engine(explicit_path=None):
    """Return a path to a Stockfish executable, or None if not found."""
    candidates = []
    if explicit_path:
        candidates.append(explicit_path)
    if os.environ.get("STOCKFISH_PATH"):
        candidates.append(os.environ["STOCKFISH_PATH"])

    # A stockfish.exe sitting next to this script (the bundled binary).
    here = os.path.dirname(os.path.abspath(__file__))
    candidates += [
        os.path.join(here, "stockfish.exe"),
        os.path.join(here, "stockfish"),
    ]

    for name in ("stockfish", "stockfish.exe"):
        found = shutil.which(name)
        if found:
            candidates.append(found)

    # Common manual install spots on Windows.
    candidates += [
        r"C:\Program Files\stockfish\stockfish.exe",
        r"C:\stockfish\stockfish.exe",
        os.path.expanduser(r"~\stockfish\stockfish.exe"),
    ]

    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


# --------------------------------------------------------------------------- #
# Board rendering (blindfold: pawns only)
# --------------------------------------------------------------------------- #
def render_blindfold(board, perspective):
    """
    Return a string drawing of the board where only pawns are visible.
    All other pieces are rendered as empty squares ('.').

    `perspective` is chess.WHITE or chess.BLACK -- the board is drawn from
    that side's point of view.
    """
    ranks = range(7, -1, -1) if perspective == chess.WHITE else range(8)
    files = range(8) if perspective == chess.WHITE else range(7, -1, -1)

    lines = []
    for rank in ranks:
        row = [f"{rank + 1} "]
        for file in files:
            square = chess.square(file, rank)
            piece = board.piece_at(square)
            if piece is not None and piece.piece_type == chess.PAWN:
                row.append("P" if piece.color == chess.WHITE else "p")
            else:
                row.append(".")
        lines.append(" ".join(row))

    file_labels = "abcdefgh" if perspective == chess.WHITE else "hgfedcba"
    lines.append("  " + " ".join(file_labels))
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Move input
# --------------------------------------------------------------------------- #
def prompt_human_move(board, perspective, level):
    """Loop until the human enters a legal move or a command. Returns a
    chess.Move, or one of the sentinels 'resign' / 'quit'."""
    while True:
        try:
            raw = input(
                "\nYour move (move / board / moves / history / pgn / resign / quit): "
            ).strip()
        except (EOFError, KeyboardInterrupt):
            return "quit"

        if not raw:
            continue

        cmd = raw.lower()
        if cmd in ("quit", "exit"):
            return "quit"
        if cmd == "resign":
            return "resign"
        if cmd == "board":
            print()
            print(render_blindfold(board, perspective))
            continue
        if cmd == "moves":
            legal = sorted(board.san(m) for m in board.legal_moves)
            print("Legal moves: " + ", ".join(legal))
            continue
        if cmd == "history":
            print("Moves: " + format_move_list(board))
            continue
        if cmd == "pgn":
            path = save_pgn(board, perspective, level)
            print(f"Game so far saved to {path}")
            continue

        # Prefer standard algebraic notation (Nf3, exd5, O-O, e8=Q); parse_san
        # validates legality too. Fall back to coordinates (e2e4). SAN is
        # case-sensitive, so parse the raw input, not the lowercased command.
        try:
            return board.parse_san(raw)
        except ValueError:
            pass

        try:
            move = chess.Move.from_uci(cmd)
        except ValueError:
            print(
                f"  Couldn't read '{raw}'. Use standard notation like Nf3, exd5, "
                "O-O (coordinates e2e4 also work). Type 'moves' for your options."
            )
            continue

        if move in board.legal_moves:
            return move
        print("  Illegal move. Type 'moves' to see your legal options.")


# --------------------------------------------------------------------------- #
# Result reporting
# --------------------------------------------------------------------------- #
def format_move_list(board):
    """Return the game's moves as numbered SAN, e.g. '1. e4 e5 2. Nf3 Nc6'."""
    if not board.move_stack:
        return "(no moves yet)"
    replay = chess.Board()
    parts = []
    for i, move in enumerate(board.move_stack):
        san = replay.san(move)
        if i % 2 == 0:
            parts.append(f"{i // 2 + 1}. {san}")
        else:
            parts.append(san)
        replay.push(move)
    return " ".join(parts)


def build_pgn_game(board, human_colour, level):
    """Construct a chess.pgn.Game from the finished/abandoned board."""
    game = chess.pgn.Game.from_board(board)
    human = "Human (blindfold)"
    sf = f"Stockfish 18 (level {level})"
    game.headers["Event"] = "Blindfold Chess (pawns only)"
    game.headers["Site"] = "blindfold_chess.py"
    game.headers["Date"] = datetime.date.today().strftime("%Y.%m.%d")
    game.headers["White"] = human if human_colour == chess.WHITE else sf
    game.headers["Black"] = sf if human_colour == chess.WHITE else human
    return game


def save_pgn(board, human_colour, level, path=None):
    """Write the game to a PGN file. Returns the path written."""
    if path is None:
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(here, f"game_{stamp}.pgn")
    game = build_pgn_game(board, human_colour, level)
    with open(path, "w", encoding="utf-8") as fh:
        print(game, file=fh, end="\n")
    return path


def describe_result(board, human_colour):
    outcome = board.outcome(claim_draw=True)
    if outcome is None:
        return "Game over."

    if outcome.winner is None:
        reason = outcome.termination.name.replace("_", " ").title()
        return f"Draw ({reason})."

    won = outcome.winner == human_colour
    who = "You win" if won else "Stockfish wins"
    reason = outcome.termination.name.replace("_", " ").title()
    return f"{who} by {reason}!"


# --------------------------------------------------------------------------- #
# Main game loop
# --------------------------------------------------------------------------- #
def play(engine_path, level, human_colour, think_time):
    board = chess.Board()

    try:
        engine = chess.engine.SimpleEngine.popen_uci(engine_path)
    except Exception as exc:  # noqa: BLE001 -- surface any engine launch failure
        print(f"Could not start Stockfish at '{engine_path}': {exc}")
        return

    # Skill Level is Stockfish's standard 0-20 strength dial.
    try:
        engine.configure({"Skill Level": level})
    except chess.engine.EngineError:
        print("(This engine ignored 'Skill Level'; playing at full strength.)")

    colour_name = "White" if human_colour == chess.WHITE else "Black"
    print(f"\nYou are {colour_name}. Stockfish skill level {level}.")
    print("Blindfold mode: only pawns are shown. Good luck.\n")
    print(render_blindfold(board, human_colour))

    try:
        while not board.is_game_over(claim_draw=True):
            if board.turn == human_colour:
                move = prompt_human_move(board, human_colour, level)
                if move == "quit":
                    print("Bye.")
                    return
                if move == "resign":
                    print("\nYou resigned. Stockfish wins.")
                    print("Moves: " + format_move_list(board))
                    path = save_pgn(board, human_colour, level)
                    print(f"Game saved to {path}")
                    return
                board.push(move)
            else:
                result = engine.play(
                    board, chess.engine.Limit(time=think_time)
                )
                san = board.san(result.move)
                board.push(result.move)
                print(f"\nStockfish plays: {san}")
                print()
                print(render_blindfold(board, human_colour))

        print("\n" + render_blindfold(board, human_colour))
        print("\n" + describe_result(board, human_colour))
        print("\nMoves: " + format_move_list(board))
        path = save_pgn(board, human_colour, level)
        print(f"Game saved to {path}")
    finally:
        engine.quit()


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Play blindfold chess (pawns only) against Stockfish."
    )
    parser.add_argument(
        "--level", type=int, default=5,
        help="Stockfish skill level, 0 (weakest) to 20 (strongest). Default 5.",
    )
    parser.add_argument(
        "--colour", "--color", choices=("white", "black", "random"),
        default="white", help="Which side you play. Default white.",
    )
    parser.add_argument(
        "--engine", default=None,
        help="Path to the Stockfish executable (overrides auto-detection).",
    )
    parser.add_argument(
        "--think-time", type=float, default=0.5,
        help="Seconds Stockfish thinks per move. Default 0.5.",
    )
    args = parser.parse_args(argv)

    if not 0 <= args.level <= 20:
        parser.error("--level must be between 0 and 20.")

    engine_path = find_engine(args.engine)
    if engine_path is None:
        print(
            "Stockfish was not found.\n"
            "Download it from https://stockfishchess.org/download/ and then "
            "either add it to your PATH, set the STOCKFISH_PATH environment "
            "variable, or pass --engine \"C:\\path\\to\\stockfish.exe\"."
        )
        return 1

    if args.colour == "random":
        human_colour = random.choice([chess.WHITE, chess.BLACK])
    else:
        human_colour = chess.WHITE if args.colour == "white" else chess.BLACK

    play(engine_path, args.level, human_colour, args.think_time)
    return 0


if __name__ == "__main__":
    sys.exit(main())
