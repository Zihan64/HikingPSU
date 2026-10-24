export const BASE = import.meta.env.VITE_API_BASE || '/api'

// One fetch helper for every endpoint. Pass `token` (an Auth0 access token) for routes that
// need or benefit from login; errors carry `.status` so callers can react to 401.
async function request(path, { method = 'GET', body, token = null, signal } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal })
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

// ---- profile, hike log and dashboard insights (all need a token) ----
export const getMe = token => request('/me', { token })
export const patchMe = (changes, token) => request('/me', { method: 'PATCH', body: changes, token })
// Deletes the account and every record of it; log out right after.
export const deleteMe = token => request('/me', { method: 'DELETE', token })
// Sign-up form shown after the first login; getMe().registered says whether it was saved.
export const register = (form, token) => request('/me/registration', { method: 'PUT', body: form, token })
export const getInsights = token => request('/me/insights', { token })
export const listHikes = token => request('/me/hikes?limit=200', { token })
export const addHike = (hike, token) => request('/me/hikes', { method: 'POST', body: hike, token })
export const deleteHike = (id, token) => request(`/me/hikes/${id}`, { method: 'DELETE', token })
export const getRecommendations = (token, k = 5) => request(`/me/recommendations?k=${k}`, { token })
// Returns suggested preference fields only; nothing is saved until patchMe().
export const parsePreferences = (text, token) => request('/me/preferences/parse', { method: 'POST', body: { text }, token })

export const getOfficialLibrary = (params = {}, signal) => request(`/official/library?${new URLSearchParams(params)}`, { signal })
export const getOfficialTrails = (areaId, activity, signal) => request(`/official/trails?${new URLSearchParams({area_id: areaId, activity})}`, { signal })
export const getOfficialGeometry = (areaId, routeId, activity, signal) => request(`/official/trails/${encodeURIComponent(areaId)}/${encodeURIComponent(routeId)}/geometry?${new URLSearchParams({activity})}`, { signal })
