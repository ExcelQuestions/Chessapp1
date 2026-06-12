// Glimpse drill: a generated position is shown for a few seconds, then hidden.
// The user paints who owns each square from memory (tap cycles yours → theirs
// → contested → clear) and gets the true territory map diffed against theirs.
import { useEffect, useState } from 'react'
import Board from './Board'
import { newDrill, paintDrill } from './api'

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
          <p>
            A position appears for a few seconds, then vanishes. Paint who owns
            each square from memory — blue yours, red theirs, amber contested.
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

      {phase === 'memorize' && drill && (
        <>
          <div className="drill-count">{left}</div>
          <Board cells={drill.cells} humanColor={drill.human_color} disabled />
          <div className="drill-actions">
            <button className="key key-submit" onClick={() => setPhase('paint')}>
              I'm ready — paint now ({drill.reveal_seconds - left}s used)
            </button>
          </div>
        </>
      )}

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
            <span className="drill-hint">tap cycles · tap again to clear</span>
          </div>
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
