import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useAuthFetch } from './auth'

// Top-right login control. After login it calls /me once, which proves the
// backend accepted the token (and lets the database create the user's row).
// onMe receives that user (or null when logged out).
export default function AuthButton({ onMe }) {
  const { isLoading, isAuthenticated, user, loginWithRedirect, logout, error } = useAuth0()
  const authFetch = useAuthFetch()
  const [backend, setBackend] = useState(null) // null = not checked, 'ok', or an error message

  useEffect(() => {
    if (!isAuthenticated) { setBackend(null); onMe?.(null); return }
    authFetch('/me').then(me => { setBackend('ok'); onMe?.(me) }).catch(e => setBackend(e.message))
  }, [isAuthenticated, authFetch, onMe])

  if (isLoading) return <span className="text-sm text-stone-400">…</span>

  if (error) {
    return <span className="text-xs text-red-700" title={error.message}>Login error: {error.message}</span>
  }

  if (!isAuthenticated) {
    return (
      <button onClick={() => loginWithRedirect()} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-50">
        Log in
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {user?.picture && <img src={user.picture} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />}
      <div className="text-right leading-tight">
        <div className="text-sm font-medium">{user?.name || user?.email}</div>
        {backend && backend !== 'ok' && <div className="text-xs text-red-700" title={backend}>backend: {backend}</div>}
      </div>
      <button
        onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
        className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs hover:bg-stone-50"
      >
        Log out
      </button>
    </div>
  )
}
