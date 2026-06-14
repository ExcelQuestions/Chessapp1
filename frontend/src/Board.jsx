// The board. Renders an 8x8 grid from the player's perspective.
//
// `cells` maps a square name (e.g. "e4") to a piece letter: P N B R Q K for
// White, lower-case for Black. In blindfold mode the parent only passes pawns;
// with "reveal pieces" on it passes the full position.

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

const GLYPH = {
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
}

// `pressure` maps square name -> {o: 'y'|'t'|'c', i: 1-3}: who owns the square
// (yours / theirs / contested) and how firmly. Rendered as a translucent tint.
// `arrows` is a list of {from, to, side: 'y'|'t'} drawn as a move overlay
// (exoskeleton mode): blue for your moves, red for the opponent's.
export default function Board({ cells, humanColor, selected, marked = [], pressure = {}, wrong = [], arrows = [], onSquareClick, disabled }) {
  const whiteView = humanColor === 'w'
  // Ranks top-to-bottom, files left-to-right, flipped for Black's perspective.
  const ranks = whiteView ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  const files = whiteView ? FILES : [...FILES].reverse()

  // Centre of a square (e.g. "e4") in grid units, for the arrow overlay.
  const centre = (name) => {
    const col = files.indexOf(name[0])
    const row = ranks.indexOf(Number(name[1]))
    if (col < 0 || row < 0) return null
    return [col + 0.5, row + 0.5]
  }

  return (
    <div className="board-wrap">
      <div className="board">
        {ranks.map((rank) =>
          files.map((file) => {
            const name = `${file}${rank}`
            const symbol = cells[name] // piece letter or undefined
            // a1 is dark: a square is light when file index + rank is even.
            const isLight = (FILES.indexOf(file) + rank) % 2 === 0
            const isSelected = selected === name
            const isMarked = marked.includes(name)
            const isWhitePiece = symbol && symbol === symbol.toUpperCase()
            return (
              <button
                key={name}
                className={
                  'square' +
                  (isLight ? ' light' : ' dark') +
                  (isSelected ? ' selected' : '') +
                  (isMarked ? ' marked' : '')
                }
                onClick={() => !disabled && onSquareClick(name)}
                disabled={disabled}
                title={name}
              >
                {pressure[name] && (
                  <span className={`tint p-${pressure[name].o} i${pressure[name].i}`} />
                )}
                {symbol && (
                  <span className={'piece ' + (isWhitePiece ? 'white' : 'black')}>
                    {GLYPH[symbol]}
                  </span>
                )}
                {wrong.includes(name) && <span className="wrongmark">✗</span>}
                <span className="coord">{name}</span>
              </button>
            )
          })
        )}
        {arrows.length > 0 && (
          <svg className="arrows" viewBox="0 0 8 8" preserveAspectRatio="none">
            <defs>
              {['y', 't'].map((s) => (
                <marker key={s} id={`ah-${s}`} markerWidth="4" markerHeight="4"
                  refX="2.6" refY="2" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L4,2 L0,4 z" className={`arrowhead a-${s}`} />
                </marker>
              ))}
            </defs>
            {arrows.map((a, i) => {
              const from = centre(a.from)
              const to = centre(a.to)
              if (!from || !to) return null
              // Pull the tip back a little so the head sits inside the target
              // square and stacked arrows stay legible.
              const dx = to[0] - from[0], dy = to[1] - from[1]
              const len = Math.hypot(dx, dy) || 1
              const tx = to[0] - (dx / len) * 0.22
              const ty = to[1] - (dy / len) * 0.22
              return (
                <line key={i} x1={from[0]} y1={from[1]} x2={tx} y2={ty}
                  className={`arrow a-${a.side}`} markerEnd={`url(#ah-${a.side})`} />
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )
}
