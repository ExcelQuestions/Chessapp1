import { useState } from 'react'
import { login } from './api'

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(password)
      onSuccess()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <h1>♟ Blindfold Chess</h1>
      <p className="tagline">Enter the password to play.</p>
      <form onSubmit={submit}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          disabled={busy}
        />
        <button className="primary" type="submit" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </form>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
