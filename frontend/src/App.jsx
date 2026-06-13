import { useState } from 'react'
import Board from './Board'
import Drill from './Drill'
import Guide from './Guide'
import Login from './Login'
import MoveKeypad from './MoveKeypad'
import Question from './Question'
import { newGame, getGame, sendMove, sendAnswer, pressureDetail, pgnUrl, getToken, setToken, AuthError } from './api'
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
  const [mode, setMode] = useState('play')
  const [selected, setSelected] = useState(null) // first-clicked square
  const [typed, setTyped] = useState('')
  const [picked, setPicked] = useState([]) // squares tapped as a quiz answer
  const [qpaint, setQpaint] = useState({}) // territory map for paint questions
  const [lastAnswer, setLastAnswer] = useState(null) // {correct, pct?} of last quiz answer
  const [pressureOn, setPressureOn] = useState(false)
  const [detail, setDetail] = useState(null) // tap-for-detail text
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
    setPicked([])
    setLastAnswer(null)
    setDetail(null)
    setBusy(true)
    try {
      setGame(await newGame({ level, colour, thinkTime: 0.5, show, mode, pressure: pressureOn }))
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
      setGame(await getGame(game.game_id, showString(nextVisible) || '-', pressureOn))
    } catch (err) {
      fail(err)
    }
  }

  async function togglePressure() {
    const next = !pressureOn
    setPressureOn(next)
    setSelected(null) // drop any half-built move; taps become inspection
    if (!next) setDetail(null)
    if (!game) return
    try {
      setGame(await getGame(game.game_id, show || '-', next))
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
      setGame(await sendMove(game.game_id, move, show || '-', pressureOn))
      setSelected(null)
      setTyped('')
      setLastAnswer(null)
      setDetail(null)
    } catch (e) {
      fail(e)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }

  // Training mode: submit the pending quiz answer. The server replies with the
  // usual state plus whether we were right — that's all the feedback there is.
  async function answer(payload) {
    if (!game || busy) return
    setError(null)
    setBusy(true)
    try {
      const res = await sendAnswer(game.game_id, payload, show || '-', pressureOn)
      setGame(res)
      setLastAnswer(res.answered)
      setPicked([])
      setQpaint({})
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const question = game && !game.game_over ? game.question : null

  function onSquareClick(name) {
    if (!game || game.turn !== 'human') return
    // While a squares-format question is pending, taps build the answer
    // instead of a move.
    if (question) {
      if (question.format === 'squares') {
        setPicked((p) => (p.includes(name) ? p.filter((s) => s !== name) : [...p, name]))
      } else if (question.format === 'paint') {
        // Cycle ownership: yours -> theirs -> contested -> clear.
        setQpaint((p) => {
          const NEXT = { y: 't', t: 'c', c: null }
          const nxt = p[name] ? NEXT[p[name]] : 'y'
          const out = { ...p }
          if (nxt) out[name] = nxt
          else delete out[name]
          return out
        })
      }
      return
    }
    // Overlay on: taps are inspection only — fetch the exchange detail and
    // never select a move (too easy to blunder a piece while studying the
    // map). Moves go through the keypad until the overlay is toggled off.
    if (pressureOn) {
      pressureDetail(game.game_id, name)
        .then((d) => setDetail(
          `${d.square}: you ×${d.your_attackers}, them ×${d.their_attackers}` +
          (d.verdict ? ` — ${d.verdict}` : '')))
        .catch(() => {})
      return
    }
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
        {mode !== 'guide' && (
          <>
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
          </>
        )}
        <label>
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="play">Play</option>
            <option value="train">Training</option>
            <option value="drill">Glimpse drill</option>
            <option value="guide">Pressure guide</option>
          </select>
        </label>
        {mode !== 'drill' && mode !== 'guide' && (
          <button className="primary" onClick={start} disabled={busy}>
            {game ? 'New game' : 'Start'}
          </button>
        )}
      </section>

      {mode !== 'drill' && mode !== 'guide' && <section className="visibility">
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
        <label className="vis-item vis-pressure">
          <input type="checkbox" checked={pressureOn} onChange={togglePressure} />
          Pressure
        </label>
        <span className="vis-presets">
          <button type="button" onClick={() => setAll(true)}>All</button>
          <button type="button" onClick={() => setAll(false)}>None</button>
        </span>
      </section>}

      {error && <div className="error">{error}</div>}

      {mode === 'drill' && <Drill colour={colour} level={level} onError={fail} />}

      {mode === 'guide' && <Guide />}

      {mode !== 'drill' && game && (
        <main className="game">
          <Board
            cells={game.cells}
            humanColor={game.human_color}
            selected={selected}
            marked={picked}
            pressure={
              question && question.format === 'paint'
                ? Object.fromEntries(Object.entries(qpaint).map(([sq, o]) => [sq, { o, i: 2 }]))
                : game.pressure || {}
            }
            onSquareClick={onSquareClick}
            disabled={busy || !yourTurn || (question && !['squares', 'paint'].includes(question.format))}
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

            {game.mode === 'train' && game.score && (
              <div className="quiz-score">
                Quiz: {game.score.correct}/{game.score.asked}
                {game.score.asked > 0 &&
                  ` (${Math.round((100 * game.score.correct) / game.score.asked)}%)`}
                {' · '}streak {game.score.streak} (best {game.score.best})
              </div>
            )}

            {lastAnswer && (
              <div className={lastAnswer.correct ? 'answer-ok' : 'answer-bad'}>
                {lastAnswer.correct ? '✓ Correct' : '✗ Wrong'}
                {lastAnswer.pct != null && ` — ${lastAnswer.pct}% agreement`}
              </div>
            )}

            {detail && <div className="pressure-detail">{detail}</div>}

            {question ? (
              <Question
                question={question}
                picked={picked}
                paint={qpaint}
                onClearPicked={() => { setPicked([]); setQpaint({}) }}
                onAnswer={answer}
                disabled={busy}
              />
            ) : (
              <MoveKeypad
                value={typed}
                onChange={setTyped}
                onSubmit={submit}
                disabled={!yourTurn || busy}
              />
            )}
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

      {mode !== 'drill' && !game && !error && (
        <p className="placeholder">
          Choose what to show, pick a level and colour, then press Start.
        </p>
      )}
    </div>
  )
}
