// Glimpse drill: a generated position is shown for a few seconds, then hidden.
// The user paints who owns each square from memory (tap cycles yours → theirs
// → contested → clear) and gets the true territory map diffed against theirs.
import { useEffect, useState } from 'react'
import Board from './Board'
import { newDrill, paintDrill } from './api'
import { STAGE, glimpseStage, stageCells } from './glimpse'

const NEXT = { y: 't', t: 'c', c: null }

const LEGEND = [
  ['p-y', 'Yours'],
  ['p-t', 'Theirs'],
  ['p-c', 'Contested'],
]

export default function Drill({ colour, level, onError }) {
  const [phase, setPhase] = useState('idle') // idle|busy|memorize|paint|result
  const [seconds, setSeconds] = useState(30)
  const [left, setLeft] = useState(0)
  const [drill, setDrill] = useState(null)
  const [paint, setPaint] = useState({}) // square -> 'y'|'t'|'c'
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (phase !== 'memorize') return
    if (left <= 0) {
      setPhase('paint')
      return
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, left])

  async function begin() {
    setPaint({})
    setResult(null)
    setPhase('busy')
    try {
      const d = await newDrill({ colour, seconds, level })
      setDrill(d)
      setLeft(d.reveal_seconds)
      setPhase('memorize')
    } catch (e) {
      onError(e)
      setPhase('idle')
    }
  }

  function tap(name) {
    if (phase !== 'paint') return
    setPaint((p) => {
      const nxt = p[name] ? NEXT[p[name]] : 'y'
      const out = { ...p }
      if (nxt) out[name] = nxt
      else delete out[name]
      return out
    })
  }

  async function submit() {
    setPhase('busy')
    try {
      setResult(await paintDrill(drill.drill_id, paint))
      setPhase('result')
    } catch (e) {
      onError(e)
      setPhase('paint')
    }
  }

  const paintMap = Object.fromEntries(
    Object.entries(paint).map(([sq, o]) => [sq, { o, i: 2 }])
  )

  return (
    <main className="drill">
      {phase === 'idle' && (
        <div className="drill-intro">
          <h3>Glimpse drill</h3>
          <p className="drill-lead">
            Rebuild the position from memory — not as a list of squares, but as
            pieces and how safe each one is. It’s the skill that separates strong
            players: they remember a position by its structure, not its
            coordinates.
          </p>
          <ol className="drill-steps">
            <li>
              <strong>Watch.</strong> A position appears in three stages — pawns
              first, then the full board, then pieces only — then vanishes.
            </li>
            <li>
              <strong>Paint.</strong> On a blank board, mark every square you
              remember a piece on. Tap a square to cycle its owner:
              <span className="legend-swatch p-y" /> yours →
              <span className="legend-swatch p-t" /> theirs →
              <span className="legend-swatch p-c" /> even trade → clear.
            </li>
            <li>
              <strong>Check.</strong> You’ll see the real position with the true
              owners, and a ✗ on every square you got wrong.
            </li>
          </ol>
          <p className="drill-note">
            The board is blank on purpose — you’re recalling <em>where</em> the
            pieces are as well as their safety. Only occupied squares are scored.
          </p>
          <label>
            Look time
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              <option value="10">10s</option>
              <option value="20">20s</option>
              <option value="30">30s</option>
              <option value="45">45s</option>
              <option value="60">60s</option>
              <option value="90">90s</option>
            </select>
          </label>
          <button className="primary" onClick={begin}>Begin drill</button>
        </div>
      )}

      {phase === 'busy' && <p className="placeholder">Working…</p>}

      {phase === 'memorize' && drill && (() => {
        const total = drill.reveal_seconds
        const stage = glimpseStage(total - left, total)
        const [label, caption] = STAGE[stage]
        return (
          <>
            <div className="drill-stagebar">
              <span className="drill-count">{left}</span>
              <span className="drill-stage">
                <strong>{label}</strong>
                <span className="drill-caption">{caption}</span>
              </span>
            </div>
            <Board cells={stageCells(drill.cells, stage)} humanColor={drill.human_color} disabled />
            <div className="drill-actions">
              <button className="key key-submit" onClick={() => setPhase('paint')}>
                I'm ready — paint now ({total - left}s used)
              </button>
            </div>
          </>
        )
      })()}

      {phase === 'paint' && drill && (
        <>
          <div className="drill-bar">
            <span className="drill-legend">
              {LEGEND.map(([cls, label]) => (
                <span key={cls} className="legend-item">
                  <span className={`legend-swatch ${cls}`} />{label}
                </span>
              ))}
            </span>
            <span className="drill-hint">mark each piece’s square · tap cycles · tap again to clear</span>
          </div>
          <p className="drill-note">
            Blank on purpose — place every piece you remember and colour it.
          </p>
          <Board cells={{}} humanColor={drill.human_color} pressure={paintMap} onSquareClick={tap} />
          <div className="drill-actions">
            <button className="key key-back" onClick={() => setPaint({})} disabled={!Object.keys(paint).length}>
              Clear all
            </button>
            <button className="key key-submit" onClick={submit}>
              Submit map ({Object.keys(paint).length} squares)
            </button>
          </div>
        </>
      )}

      {phase === 'result' && result && (
        <>
          <div className="drill-score">
            <strong>{result.score.pct}%</strong> — {result.score.right} right,{' '}
            {result.score.missed} missed, {result.score.phantom} phantom
            {result.score.phantom === 1 ? ' mark' : ' marks'}
          </div>
          <p className="drill-note">
            <em>Missed</em> = a piece you didn’t mark or coloured wrong.{' '}
            <em>Phantom</em> = a mark on a square with no piece. Squares with a ✗
            are the ones to look at.
          </p>
          <Board
            cells={result.cells}
            humanColor={result.human_color}
            pressure={result.truth}
            wrong={result.wrong}
            disabled
          />
          <div className="drill-actions">
            <button className="primary" onClick={begin}>Drill again</button>
          </div>
        </>
      )}
    </main>
  )
}
