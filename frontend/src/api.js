// Thin wrapper around the FastAPI backend. All calls go to /api (proxied to
// the Python server in dev). The server is the source of truth and only sends
// the piece types listed in `show` (a subset of "pnbrqk"); hidden types never
// reach the browser, so the blindfold stays honest however it's configured.

async function handle(res) {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body && body.detail) detail = body.detail
    } catch {
      // ignore parse errors, keep generic message
    }
    throw new Error(detail)
  }
  return res.json()
}

export function newGame({ level, colour, thinkTime, show }) {
  return fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, colour, think_time: thinkTime, show }),
  }).then(handle)
}

export function getGame(gameId, show) {
  return fetch(`/api/games/${gameId}?show=${show}`).then(handle)
}

export function sendMove(gameId, move, show) {
  return fetch(`/api/games/${gameId}/move?show=${show}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ move }),
  }).then(handle)
}

export function pgnUrl(gameId) {
  return `/api/games/${gameId}/pgn`
}
