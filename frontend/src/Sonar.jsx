// Sonar — the integrated board-vision curriculum. Each rep runs one position
// through four phases, each a different learning mechanism:
//   Glimpse  encode    (staged reveal, chunking)
//   Recall   reconstruct (paint territory from memory — retrieval practice)
//   Read     reason    (one relational question — elaborative interrogation)
//   Play     apply     (find a strong move blindfold — engine-scored transfer)
// Then prediction-error feedback (truth revealed) and an adaptive staircase
// that keeps difficulty in the ~75-85% success band.
import { useEffect, useState } from 'react'
import Board from './Board'
import Question from './Question'
import MoveKeypad from './MoveKeypad'
import { STAGE, glimpseStage, stageCells } from './glimpse'
import { sonarStart, sonarNext, sonarRecall, sonarAnswer, sonarMove } from './api'

const PAINT_NEXT = { y: 't', t: 'c', c: null }

export default function Sonar({ onError }) {
  const [phase, setPhase] = useState('intro') // intro|busy|glimpse|recall|read|play|reveal
  const [tier, setTier] = useState(2)
  const [level, setLevel] = useState(6)

  const [sid, setSid] = useState(null)
  const [rep, setRep] = useState(null)   // current rep payload from the server
  const [left, setLeft] = useState(0)    // glimpse countdown

  const [paint, setPaint] = useState({}) // recall territory map
  const [recallPct, setRecallPct] = useState(null)
  const [picked, setPicked] = useState([]) // read: squares answer
  const [readOk, setReadOk] = useState(null)
  const [selected, setSelected] = useState(null) // play: click-to-move
  const [typed, setTyped] = useState('')
  const [moveErr, setMoveErr] = useState(null)
  const [result, setResult] = useState(null) // move response (reveal)

  // Glimpse countdown.
  useEffect(() => {
    if (phase !== 'glimpse') return
    if (left <= 0) { setPhase('recall'); return }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, left])

  function loadRep(r) {
    setRep(r)
    setLeft(r.reveal_seconds)
    setPaint({}); setRecallPct(null); setPicked([]); setReadOk(null)
    setSelected(null); setTyped(''); setMoveErr(null); setResult(null)
    setPhase('glimpse')
  }

  async function begin() {
    setPhase('busy')
    try { const r = await sonarStart({ tier, level }); setSid(r.session_id); loadRep(r) }
    catch (e) { onError(e); setPhase('intro') }
  }

  async function nextRep() {
    setPhase('busy')
    try { loadRep(await sonarNext(sid)) }
    catch (e) { onError(e); setPhase('reveal') }
  }

  async function submitRecall() {
    setPhase('busy')
    try { const r = await sonarRecall(sid, paint); setRecallPct(r.score.pct); setPhase('read') }
    catch (e) { onError(e); setPhase('recall') }
  }

  async function submitAnswer(payload) {
    setPhase('busy')
    try { const r = await sonarAnswer(sid, payload); setReadOk(r.correct); setPhase('play') }
    catch (e) { onError(e); setPhase('read') }
  }

  async function submitMove(move) {
    setPhase('busy')
    try { setResult(await sonarMove(sid, move)); setPhase('reveal') }
    catch (e) {
      // Illegal/unreadable move: stay in Play with a hint, don't lose the rep.
      setMoveErr(e.message); setPhase('play')
    }
  }

  // One click handler, behaviour depends on the phase.
  function onSquare(name) {
    if (phase === 'recall') {
      setPaint((p) => {
        const nxt = p[name] ? PAINT_NEXT[p[name]] : 'y'
        const out = { ...p }
        if (nxt) out[name] = nxt; else delete out[name]
        return out
      })
    } else if (phase === 'read' && rep.question.format === 'squares') {
      setPicked((p) => (p.includes(name) ? p.filter((s) => s !== name) : [...p, name]))
    } else if (phase === 'play') {
      if (!selected) { setSelected(name); return }
      if (selected === name) { setSelected(null); return }
      submitMove(selected + name)
    }
  }

  const paintTint = (m) =>
    Object.fromEntries(Object.entries(m).map(([sq, o]) => [sq, { o, i: 2 }]))

  // ---- intro ----
  if (phase === 'intro') {
    return (
      <main className="sonar">
        <h2>Sonar</h2>
        <p className="sonar-lead">
          One position, four passes — <strong>see it, rebuild it, read it, play it</strong>.
          You glimpse a position, paint its forces from memory, answer a question
          about it, then find a move — all blindfold. The difficulty tunes itself
          to keep you working at the edge of what you can do.
        </p>
        <ol className="sonar-phases">
          <li><strong>Glimpse</strong> — it appears in stages, then vanishes.</li>
          <li><strong>Recall</strong> — paint who owns each piece’s square.</li>
          <li><strong>Read</strong> — answer one question about the forces.</li>
          <li><strong>Play</strong> — find a strong move, still blindfold.</li>
        </ol>
        <div className="sonar-opts">
          <label>Start tier
            <select value={tier} onChange={(e) => setTier(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>Position strength
            <input type="range" min="0" max="20" value={level}
              onChange={(e) => setLevel(Number(e.target.value))} />
            <strong>{level}</strong>
          </label>
        </div>
        <button className="primary" onClick={begin}>Begin session</button>
      </main>
    )
  }

  const scoreboard = rep && (
    <div className="sonar-bar">
      <span>Rep {result ? result.reps_done : rep.rep}</span>
      <span>Tier {result ? result.tier : rep.tier}</span>
      {result && <span>Avg {result.session_avg}%</span>}
    </div>
  )

  return (
    <main className="sonar">
      {scoreboard}

      {phase === 'busy' && <p className="placeholder">Working…</p>}

      {phase === 'glimpse' && rep && (() => {
        const stage = glimpseStage(rep.reveal_seconds - left, rep.reveal_seconds)
        const [label, caption] = STAGE[stage]
        return (
          <>
            <div className="drill-stagebar">
              <span className="drill-count">{left}</span>
              <span className="drill-stage"><strong>{label}</strong>
                <span className="drill-caption">{caption}</span></span>
            </div>
            <Board cells={stageCells(rep.cells, stage)} humanColor={rep.human_color} disabled />
            <div className="drill-actions">
              <button className="key key-submit" onClick={() => setPhase('recall')}>
                I’m ready ({rep.reveal_seconds - left}s used)
              </button>
            </div>
          </>
        )
      })()}

      {phase === 'recall' && rep && (
        <>
          <p className="sonar-prompt">Paint who owns each piece’s square — blue yours, red theirs, amber even.</p>
          <Board cells={{}} humanColor={rep.human_color} pressure={paintTint(paint)} onSquareClick={onSquare} />
          <div className="drill-actions">
            <button className="key key-back" onClick={() => setPaint({})} disabled={!Object.keys(paint).length}>Clear</button>
            <button className="key key-submit" onClick={submitRecall}>Submit ({Object.keys(paint).length})</button>
          </div>
        </>
      )}

      {phase === 'read' && rep && (
        <>
          {recallPct != null && <p className="sonar-sub">Recall: {recallPct}%</p>}
          <Board cells={{}} humanColor={rep.human_color} marked={picked} onSquareClick={onSquare} />
          <Question
            question={rep.question}
            picked={picked}
            onClearPicked={() => setPicked([])}
            onAnswer={submitAnswer}
            disabled={false}
          />
        </>
      )}

      {phase === 'play' && rep && (
        <>
          <p className="sonar-prompt">
            Your move ({rep.human_color === 'w' ? 'White' : 'Black'}). Find a strong move — blindfold.
          </p>
          <Board cells={{}} humanColor={rep.human_color} selected={selected} onSquareClick={onSquare} />
          {moveErr && <div className="error">{moveErr}</div>}
          <MoveKeypad value={typed} onChange={setTyped} onSubmit={submitMove} disabled={false} />
        </>
      )}

      {phase === 'reveal' && result && (
        <>
          <div className={'sonar-verdict v-' + result.move.quality}>
            You played <code>{result.move.played}</code> — <strong>{result.move.verdict}</strong>
            {result.move.verdict !== 'Best move' && <> · best was <code>{result.move.best.san}</code></>}
            {' '}({result.move.cp_loss} cp lost)
          </div>
          <div className="sonar-repscore">
            Recall {result.rep_score.recall}% · Read {result.rep_score.read ? '✓' : '✗'} ·
            Move {result.rep_score.move}% → <strong>rep {result.rep_score.composite}%</strong>
            {result.tier_changed > 0 && <span className="tier-up"> · tier up to {result.tier}</span>}
            {result.tier_changed < 0 && <span className="tier-down"> · tier down to {result.tier}</span>}
          </div>
          <Board
            cells={result.cells}
            humanColor={result.human_color}
            pressure={result.pressure}
            arrows={[{ from: result.move.best.from, to: result.move.best.to, side: 'y' }]}
            disabled
          />
          <p className="sonar-sub">Blue arrow = the engine’s best move. Tints = the true territory.</p>
          <div className="drill-actions">
            <button className="primary" onClick={nextRep}>Next position</button>
          </div>
        </>
      )}
    </main>
  )
}
