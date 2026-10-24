<<<<<<< HEAD
const BASE = import.meta.env.VITE_API_BASE || '/api'
const TOKEN_KEY = 'hikingpsu.token'

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
=======
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
>>>>>>> 977baf91bd1fd85331ca8dd01797821748ea8323
}

export function setToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY) } catch { /* storage blocked */ }
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token && auth) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!r.ok) {
    let detail = `API ${r.status}`
    try {
      const j = await r.json()
      if (typeof j.detail === 'string') detail = j.detail
      else if (Array.isArray(j.detail)) detail = j.detail.map(d => d.msg).join('; ')
    } catch { /* non-JSON error body */ }
    const err = new Error(detail)
    err.status = r.status
    throw err
  }
  return r.status === 204 ? null : r.json()
}

export const chat = (messages, profile) => request('/chat', { method: 'POST', body: { messages, profile } })
export const listTrails = () => request('/trails')

// ---- accounts ----
export async function authenticate(mode, email, password) {
  const { access_token } = await request(`/auth/${mode}`, { method: 'POST', body: { email, password } })
  setToken(access_token)
}

// ---- reviews ----
export const getReviewSummaries = () => request('/reviews/summary')
export const getTrailReviews = id => request(`/trails/${id}/reviews`, { auth: true })
export const saveReview = (id, review) => request(`/trails/${id}/reviews/me`, { method: 'PUT', body: review, auth: true })
export const deleteReview = id => request(`/trails/${id}/reviews/me`, { method: 'DELETE', auth: true })
