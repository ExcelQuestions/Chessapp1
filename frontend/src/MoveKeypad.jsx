const PIECES = ['N', 'B', 'R', 'Q', 'K']
const FILES  = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS  = ['1', '2', '3', '4', '5', '6', '7', '8']

export default function MoveKeypad({ value, onChange, onSubmit, disabled }) {
  const append = (ch) => onChange(value + ch)
  const backspace = () => onChange(value.slice(0, -1))

  return (
    <div className="keypad">
      <div className="keypad-display">
        {value
          ? <span className="keypad-value">{value}</span>
          : <span className="keypad-placeholder">tap to build a move</span>}
      </div>

      {/* Pieces + capture + promotion */}
      <div className="keypad-row">
        {PIECES.map((p) => (
          <button key={p} className="key key-piece" onClick={() => append(p)} disabled={disabled}>{p}</button>
        ))}
        <button className="key key-sym" onClick={() => append('x')} disabled={disabled}>x</button>
        <button className="key key-sym" onClick={() => append('=')} disabled={disabled}>=</button>
      </div>

      {/* Files */}
      <div className="keypad-row">
        {FILES.map((f) => (
          <button key={f} className="key" onClick={() => append(f)} disabled={disabled}>{f}</button>
        ))}
      </div>

      {/* Ranks */}
      <div className="keypad-row">
        {RANKS.map((r) => (
          <button key={r} className="key" onClick={() => append(r)} disabled={disabled}>{r}</button>
        ))}
      </div>

      {/* Castling shortcuts + backspace + submit */}
      <div className="keypad-row">
        <button className="key key-castle" onClick={() => { onChange(''); onSubmit('O-O-O') }} disabled={disabled}>O-O-O</button>
        <button className="key key-castle" onClick={() => { onChange(''); onSubmit('O-O')   }} disabled={disabled}>O-O</button>
        <button className="key key-back"   onClick={backspace} disabled={disabled || !value}>⌫</button>
        <button className="key key-submit" onClick={() => { if (value.trim()) { onSubmit(value.trim()); onChange('') } }} disabled={disabled || !value}>Move ✓</button>
      </div>
    </div>
  )
}
