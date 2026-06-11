import { useState } from 'react'
import Board from './Board'
import Login from './Login'
import { newGame, getGame, sendMove, pgnUrl, getToken, setToken, AuthError } from './api'
import './App.css'

// Piece types, in the canonical order the server uses.
const TYPES = [
  ['p', 'Pawns'],
  ['n', 'Knights'],
  ['b', 'Bishops'],
  ['r', 'Rooks'],
  ['q', 'Queens'],
  ['k', 'Kings'],
]

// Turn the {p:true, n:false, ...} map into the "show" string the API wants.
function showString(visible) {
  return TYPES.map(([t]) => t).filter((t) => visible[t]).join('')
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()))
  const [game, setGame] = useState(null) // latest state from the server
  const [level, setLevel] = useState(5)
  const [colour, setColour] = useState('white')
  const [selected, setSelected] = useState(null) // first-clicked square
  const [typed, setTyped] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Which piece types are visible. Default = classic blindfold (pawns only).
  const [visible, setVisible] = useState({
    p: true, n: false, b: false, r: false, q: false, k: false,
  })

  const show = showString(visible)

  // Centralised error handling: an expired/invalid token drops us to login.
  function fail(e) {
    if (e instanceof AuthError) {
      setAuthed(false)
      setGame(null)
    }
    setError(e.message)
  }

  function signOut() {
    setToken('')
    setAuthed(false)
    setGame(null)
    setError(null)
  }

  async function start() {
    setError(null)
    setSelected(null)
    setBusy(true)
    try {
      setGame(await newGame({ level, colour, thinkTime: 0.5, show }))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  // Toggle a single piece type. If a game is live, refetch so the board
  // immediately reflects the new visibility.
  async function setVisibility(nextVisible) {
    setVisible(nextVisible)
    if (!game) return
    try {
      setGame(await getGame(game.game_id, showString(nextVisible) || '-'))
    } catch (err) {
      fail(err)
    }
  }

  const toggleType = (t) => setVisibility({ ...visible, [t]: !visible[t] })
  const setAll = (on) =>
    setVisibility(Object.fromEntries(TYPES.map(([t]) => [t, on])))

  async function submit(move) {
    if (!game || busy) return
    setError(null)
    setBusy(true)
    try {
      setGame(await sendMove(game.game_id, move, show || '-'))
      setSelected(null)
      setTyped('')
    } catch (e) {
      fail(e)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }

  function onSquareClick(name) {
    if (!game || game.turn !== 'human') return
    if (!selected) {
      setSelected(name)
      return
    }
    if (selected === name) {
      setSelected(null)
      return
    }
    // Clicks send coordinates (the server resolves them); typing uses SAN.
    // Auto-queen when a visible pawn steps onto the last rank; use the text
    // box for an under-promotion (e.g. e8=N).
    let coords = selected + name
    const movingPawn = (game.cells[selected] || '').toLowerCase() === 'p'
    const toRank = Number(name[1])
    if (movingPawn && (toRank === 8 || toRank === 1)) coords += 'q'
    submit(coords)
  }

  function onTypedSubmit(e) {
    e.preventDefault()
    const v = typed.trim() // SAN is case-sensitive (N vs n), so don't lowercase
    if (v) submit(v)
  }

  const yourTurn = game && game.turn === 'human' && !game.game_over
  const colourLabel = game && (game.human_color === 'w' ? 'White' : 'Black')

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />

  return (
    <div className="app">
      <header>
        <button className="signout" onClick={signOut}>Sign out</button>
        <h1>♟ Blindfold Chess</h1>
        <p className="tagline">
          Hide as much as you dare — whatever you hide lives only in your head.
        </p>
      </header>

      <section className="controls">
        <label>
          Level <strong>{level}</strong>
          <input
            type="range"
            min="0"
            max="20"
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
        </label>
        <label>
          Play as
          <select value={colour} onChange={(e) => setColour(e.target.value)}>
            <option value="white">White</option>
            <option value="black">Black</option>
            <option value="random">Random</option>
          </select>
        </label>
        <button className="primary" onClick={start} disabled={busy}>
          {game ? 'New game' : 'Start'}
        </button>
      </section>

      <section className="visibility">
        <span className="vis-label">Show:</span>
        {TYPES.map(([t, label]) => (
          <label key={t} className="vis-item">
            <input
              type="checkbox"
              checked={visible[t]}
              onChange={() => toggleType(t)}
            />
            {label}
          </label>
        ))}
        <span className="vis-presets">
          <button type="button" onClick={() => setAll(true)}>All</button>
          <button type="button" onClick={() => setAll(false)}>None</button>
        </span>
      </section>

      {error && <div className="error">{error}</div>}

      {game && (
        <main className="game">
          <Board
            cells={game.cells}
            humanColor={game.human_color}
            selected={selected}
            onSquareClick={onSquareClick}
            disabled={busy || !yourTurn}
          />

          <aside className="panel">
            <div className="status">
              {game.game_over ? (
                <span className="result">{game.result_text}</span>
              ) : yourTurn ? (
                <span className="your-turn">
                  Your move ({colourLabel})
                  {game.in_check && <em className="check"> — check!</em>}
                </span>
              ) : (
                <span>Stockfish is thinking…</span>
              )}
            </div>

            {game.last_engine_move && (
              <div className="last-move">
                Stockfish played <code>{game.last_engine_move.san}</code>
              </div>
            )}

            <form className="move-entry" onSubmit={onTypedSubmit}>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Nf3, exd5, O-O (or click two squares)"
                disabled={!yourTurn || busy}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" disabled={!yourTurn || busy}>
                Move
              </button>
            </form>
            {selected && (
              <div className="hint">
                From <code>{selected}</code> — click destination, or click{' '}
                <code>{selected}</code> again to cancel.
              </div>
            )}

            <div className="history">
              <h3>Moves</h3>
              <p>{game.move_count ? game.history : '(none yet)'}</p>
            </div>

            <a className="pgn" href={pgnUrl(game.game_id)} target="_blank" rel="noreferrer">
              Download PGN
            </a>
          </aside>
        </main>
      )}

      {!game && !error && (
        <p className="placeholder">
          Choose what to show, pick a level and colour, then press Start.
        </p>
      )}
    </div>
  )
}
