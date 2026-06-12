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
export default function Board({ cells, humanColor, selected, marked = [], pressure = {}, wrong = [], onSquareClick, disabled }) {
  const whiteView = humanColor === 'w'
  // Ranks top-to-bottom, files left-to-right, flipped for Black's perspective.
  const ranks = whiteView ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  const files = whiteView ? FILES : [...FILES].reverse()

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
                {wrong.includes(name) && <span className="wrongmark">✗</span>}
                {symbol && (
                  <span className={'piece ' + (isWhitePiece ? 'white' : 'black')}>
                    {GLYPH[symbol]}
                  </span>
                )}
                <span className="coord">{name}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
