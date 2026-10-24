export const BASE = import.meta.env.VITE_API_BASE || '/api'

// token: Auth0 access token when logged in (saves the chat and uses the stored profile), else null.
// sessionId: continue a saved chat; null starts a new one.
export async function chat(messages, profile, { token = null, sessionId = null } = {}) {
  const r = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, profile, session_id: sessionId }),
  })
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

export async function listTrails() {
  const r = await fetch(`${BASE}/trails`)
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}
