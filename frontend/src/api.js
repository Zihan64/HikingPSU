export const BASE = import.meta.env.VITE_API_BASE || '/api'

// One fetch helper for every endpoint. Pass `token` (an Auth0 access token) for routes that
// need or benefit from login; errors carry `.status` so callers can react to 401.
async function request(path, { method = 'GET', body, token = null } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
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

// token: when logged in, the server uses the saved profile/hike history and saves this chat.
// sessionId: continue a saved chat; null starts a new one.
export const chat = (messages, profile, { token = null, sessionId = null } = {}) =>
  request('/chat', { method: 'POST', body: { messages, profile, session_id: sessionId }, token })
export const listTrails = () => request('/trails')

// ---- reviews (reading is public; a token marks your own review as `mine`) ----
export const getReviewSummaries = () => request('/reviews/summary')
export const getTrailReviews = (id, token = null) => request(`/trails/${id}/reviews`, { token })
export const saveReview = (id, review, token) => request(`/trails/${id}/reviews/me`, { method: 'PUT', body: review, token })
export const deleteReview = (id, token) => request(`/trails/${id}/reviews/me`, { method: 'DELETE', token })
