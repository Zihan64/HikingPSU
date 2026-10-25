// Public profiles: the "open this hiker's profile" context, plus pure helpers for handles and ?u= links.
import { createContext, useContext } from 'react'

// Same rule as the server: 3-20 characters, lowercase a-z, 0-9 and _, starting with a letter.
export const HANDLE_PATTERN = /^[a-z][a-z0-9_]{2,19}$/
export const HANDLE_HINT = '3–20 characters: lowercase letters, numbers and _, starting with a letter.'

// App provides openProfile(handle); null outside it, so names stay plain text.
export const ProfileLinkContext = createContext(null)
export const useOpenProfile = () => useContext(ProfileLinkContext)

// What people type or paste: " @Alex_K " -> "alex_k". Handles are stored lowercase.
export const normalizeHandle = value => String(value ?? '').trim().replace(/^@/, '').toLowerCase()

// Why a (normalized) handle would be refused, or null when it fits the rule. Reserved names are the server's call.
export function handleProblem(handle) {
  if (handle.length < 3 || handle.length > 20) return 'Usernames are 3–20 characters long.'
  if (!/^[a-z]/.test(handle)) return 'Start your username with a letter.'
  if (!HANDLE_PATTERN.test(handle)) return 'Use only lowercase letters, numbers and underscores.'
  return null
}

export const profileUrl = (handle, origin) => `${origin}/?u=${encodeURIComponent(handle)}`

// A shared profile link: "?u=alex&x=1" -> {handle: 'alex', search: '?x=1'}. handle is null when
// there is no (non-empty) u; search is the query string without u, for history.replaceState.
export function readProfileParam(search = '') {
  const params = new URLSearchParams(search)
  if (!params.has('u')) return { handle: null, search }
  const handle = normalizeHandle(params.get('u'))
  params.delete('u')
  const rest = params.toString()
  return { handle: handle || null, search: rest ? `?${rest}` : '' }
}

// 'YYYY-MM-DD' -> 'September 2025'. Read as a calendar date so no timezone moves it to the previous month.
export function formatJoined(date) {
  const m = /^(\d{4})-(\d{2})/.exec(date || '')
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
