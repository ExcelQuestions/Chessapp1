# Blindfold Chess vs Stockfish

Play chess against the Stockfish engine with a twist: it's **blindfold chess**.
By default only the pawns are drawn — every other piece is hidden, so you have
to track your knights, bishops, rooks, queen and king in your head. Visibility
is fully configurable: hide the pawns too for a total blindfold, or reveal any
combination of piece types as a training aid.

Moves are entered in **standard algebraic notation** (`e4`, `Nf3`, `exd5`,
`O-O`, `e8=Q`); in the web app you can also click two squares.

This one repo holds three things that share the same core logic:

| Path | What it is |
|------|------------|
| `blindfold_chess.py` | Standalone command-line version |
| `server.py` | FastAPI backend (holds the true board, enforces the blindfold) |
| `frontend/` | Vite + React web UI |

## The blindfold is enforced server-side

The web server is the only thing that knows the full position. It only ever
sends the browser the piece *types* you've chosen to show — hidden pieces never
leave the server, so the blindfold stays honest even if you inspect the network
traffic.

## Prerequisites

- **Python 3.11+**
- **Node 18+** (only for the web UI)
- **A Stockfish binary** — this is *not* committed (it's ~114 MB). Download it
  from <https://stockfishchess.org/download/> and either:
  - drop `stockfish.exe` (or `stockfish`) in the repo root — the app finds it
    automatically, **or**
  - put it on your `PATH`, set `STOCKFISH_PATH`, or pass `--engine`.

## Setup

```bash
python -m pip install -r requirements.txt   # Python deps
npm --prefix frontend install               # frontend deps (web UI only)
```

## Run — command-line version

```bash
python blindfold_chess.py --level 5 --colour white
```

`--level 0–20` sets Stockfish's strength, `--colour white|black|random` picks
your side. In-game commands: `board`, `moves`, `history`, `pgn`, `resign`,
`quit`.

## Run — web app (two processes)

```bash
python -m uvicorn server:app --port 8000    # backend
npm --prefix frontend run dev               # frontend (Vite dev server)
```

Then open the URL Vite prints (usually <http://localhost:5173>). The dev server
proxies `/api` to the backend on port 8000.

## Notes

- Games can be exported to PGN (a button in the UI; the CLI auto-saves on game
  over and on resign). Saved `game_*.pgn` files are git-ignored.
- The bundled `stockfish.exe`, `node_modules/`, and build output are all
  git-ignored — see `.gitignore`.
