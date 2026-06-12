// Training-mode quiz panel. The server only ever sends the question text and
// its answer format — the truth stays server-side, so this component just
// collects an answer and reports correct/incorrect.
//
// Formats:
//   squares — the user taps squares on the board (parent owns that state and
//             passes the current selection in `picked`)
//   yesno   — two buttons
//   count   — number buttons 0-8

export default function Question({ question, picked, onClearPicked, onAnswer, disabled }) {
  const fmt = question.format

  return (
    <div className="question">
      <div className="question-text">{question.text}</div>

      {fmt === 'squares' && (
        <>
          <div className="question-picked">
            {picked.length
              ? picked.map((sq) => <code key={sq}>{sq}</code>)
              : <span className="question-hint">Tap squares on the board…</span>}
          </div>
          <div className="question-actions">
            <button
              className="key key-sym"
              onClick={() => onAnswer({ squares: [] })}
              disabled={disabled}
            >
              None
            </button>
            <button
              className="key key-back"
              onClick={onClearPicked}
              disabled={disabled || !picked.length}
            >
              Clear
            </button>
            <button
              className="key key-submit"
              onClick={() => onAnswer({ squares: picked })}
              disabled={disabled || !picked.length}
            >
              Answer ✓
            </button>
          </div>
        </>
      )}

      {fmt === 'yesno' && (
        <div className="question-actions">
          <button className="key key-submit" onClick={() => onAnswer({ yesno: true })} disabled={disabled}>
            Yes
          </button>
          <button className="key key-sym" onClick={() => onAnswer({ yesno: false })} disabled={disabled}>
            No
          </button>
        </div>
      )}

      {fmt === 'count' && (
        <div className="question-actions">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <button key={n} className="key" onClick={() => onAnswer({ count: n })} disabled={disabled}>
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
