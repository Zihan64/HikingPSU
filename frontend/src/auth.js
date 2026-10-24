// Auth0 settings come from Vite env vars (all three are public, not secrets).
// If they are missing, login is simply hidden and the rest of the app works as before.
import { useCallback } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { BASE } from './api'

export const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN
export const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID
export const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE
export const AUTH_ENABLED = Boolean(AUTH0_DOMAIN && AUTH0_CLIENT_ID && AUTH0_AUDIENCE)

/**
 * fetch() for endpoints that need login (check-ins, reviews, badges, /me).
 *
 *   const authFetch = useAuthFetch()
 *   const res = await authFetch('/checkins/start', { method: 'POST', body: JSON.stringify({...}) })
 *
 * Adds the Auth0 access token, JSON headers and the API base URL.
 * Throws if the user is not logged in or the server answers with an error.
 */
export function useAuthFetch() {
  const { getAccessTokenSilently, isAuthenticated, loginWithRedirect } = useAuth0()

  return useCallback(async (path, options = {}) => {
    if (!isAuthenticated) {
      await loginWithRedirect()
      throw new Error('login required')
    }
    const token = await getAccessTokenSilently()
    const r = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    })
    if (!r.ok) {
      const detail = await r.json().then(j => (Array.isArray(j.detail) ? j.detail.map(d => d.msg).join('; ') : j.detail)).catch(() => null)
      throw new Error(detail || `API ${r.status}`)
    }
    return r.status === 204 ? null : r.json()
  }, [getAccessTokenSilently, isAuthenticated, loginWithRedirect])
}

/**
 * Returns an async function that resolves to an access token when the user is logged in,
 * or null otherwise. Never throws; safe to call when login isn't configured.
 *
 *   const getToken = useOptionalToken()
 *   const data = await getTrailReviews(id, await getToken())
 */
export function useOptionalToken() {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0()
  return useCallback(async () => {
    if (!AUTH_ENABLED || !isAuthenticated) return null
    try { return await getAccessTokenSilently() } catch { return null }
  }, [isAuthenticated, getAccessTokenSilently])
}
