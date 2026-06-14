// Thin wrapper around the FastAPI backend. All calls go to /api (proxied to
// the Python server in dev, same-origin in production).
//
// Auth: log in once with the shared password to get a bearer token, which we
// keep in localStorage and send on every request. The server only sends the
// piece types listed in `show`; hidden types never reach the browser.

const TOKEN_KEY = 'bc_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

function authHeaders() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// Raised when the server rejects our token, so the UI can drop back to login.
export class AuthError extends Error {}

async function handle(res) {
  if (res.status === 401) {
    setToken('')
    throw new AuthError('Your session has expired — please sign in again.')
  }
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

export async function login(password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (res.status === 401) throw new Error('Wrong password.')
  if (!res.ok) throw new Error(`Login failed (${res.status})`)
  const { token } = await res.json()
  setToken(token)
  return token
}

export function newGame({ level, colour, thinkTime, show, mode, pressure, arrows }) {
  return fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      level, colour, think_time: thinkTime, show, mode,
      pressure: Boolean(pressure),
      arrows: Boolean(arrows),
    }),
  }).then(handle)
}

export function getGame(gameId, show, pressure, arrows) {
  return fetch(`/api/games/${gameId}?show=${show}&pressure=${pressure ? 1 : 0}&arrows=${arrows ? 1 : 0}`, {
    headers: authHeaders(),
  }).then(handle)
}

// Glimpse drill: generate a position to memorise, then submit a painted
// territory map ({square: 'y'|'t'|'c'}) for diffing against the truth.
export function newDrill({ colour, seconds, level }) {
  return fetch('/api/drills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ colour, seconds, level }),
  }).then(handle)
}

export function paintDrill(drillId, paint) {
  return fetch(`/api/drills/${drillId}/paint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ paint }),
  }).then(handle)
}

// Tap-for-detail on a square when the pressure overlay is on: attacker counts
// and the exchange verdict in pawn units.
export function pressureDetail(gameId, square) {
  return fetch(`/api/games/${gameId}/pressure/${square}`, {
    headers: authHeaders(),
  }).then(handle)
}

// Training mode: answer the pending quiz question. `payload` carries exactly
// one of {squares: [...]}, {yesno: bool} or {count: n} to match the question
// format. Response is the usual game state plus {answered: {correct}}.
export function sendAnswer(gameId, payload, show, pressure, arrows) {
  return fetch(`/api/games/${gameId}/answer?show=${show}&pressure=${pressure ? 1 : 0}&arrows=${arrows ? 1 : 0}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  }).then(handle)
}

export function sendMove(gameId, move, show, pressure, arrows) {
  return fetch(`/api/games/${gameId}/move?show=${show}&pressure=${pressure ? 1 : 0}&arrows=${arrows ? 1 : 0}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ move }),
  }).then(handle)
}

// The PGN link is a plain <a href>, which can't send headers, so pass the
// token as a query param (the server accepts it there too).
export function pgnUrl(gameId) {
  return `/api/games/${gameId}/pgn?token=${encodeURIComponent(getToken())}`
}
