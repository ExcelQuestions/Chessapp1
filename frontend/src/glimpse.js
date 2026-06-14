// Staged-reveal helpers shared by the glimpse drill and Sonar. Pawns are the
// structural skeleton expert memory chunks around, so the reveal goes pawns
// first (prime the frame), then the full board (integrate the pieces), then
// pieces only (hold the structure from memory; recency boost on the hard part).

export const isPawn = (sym) => sym && sym.toLowerCase() === 'p'

export const STAGE = {
  pawns:  ['Pawn skeleton', 'Fix the pawn structure — the frame everything hangs on.'],
  full:   ['Full position', 'Place the pieces onto the pawn frame.'],
  pieces: ['Pieces only', 'Pawns gone — hold their structure in your mind.'],
}

// First 30% pawns, middle 60% full, final 10% pieces.
export function glimpseStage(elapsed, total) {
  if (elapsed < total * 0.3) return 'pawns'
  if (elapsed < total * 0.9) return 'full'
  return 'pieces'
}

export function stageCells(cells, stage) {
  if (stage === 'full') return cells
  return Object.fromEntries(
    Object.entries(cells).filter(([, sym]) =>
      stage === 'pawns' ? isPawn(sym) : !isPawn(sym))
  )
}
