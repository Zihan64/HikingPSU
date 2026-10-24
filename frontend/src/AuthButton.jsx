import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useAuthFetch } from './auth'

// Top-right login control. After login it calls /me once, which proves the
// backend accepted the token (and lets the database create the user's row).
export default function AuthButton({ onProfile, profileActive = false }) {
  const { isLoading, isAuthenticated, user, loginWithPopup, logout, error } = useAuth0()
  const authFetch = useAuthFetch()
  const [backend, setBackend] = useState(null) // null = not checked, 'ok', or an error message

  useEffect(() => {
    if (!isAuthenticated) { setBackend(null); return }
    authFetch('/me').then(() => setBackend('ok')).catch(e => setBackend(e.message))
  }, [isAuthenticated, authFetch])

  if (isLoading) return <span className="text-sm text-stone-400">…</span>

  // Closing, blocking or timing out the pop-up is routine: keep offering "Log in".
  const popupHiccup = ['cancelled', 'popup_open', 'timeout'].includes(error?.error)
  if (error && !popupHiccup) {
    return <span className="text-xs text-red-700" title={error.message}>Login error: {error.message}</span>
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={() => loginWithPopup()}
        title={error?.error === 'popup_open' ? 'Allow pop-ups for this site to log in' : undefined}
        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-50"
      >
        Log in
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {/* Avatar + name open the profile dashboard. */}
      <button
        type="button"
        onClick={onProfile}
        aria-pressed={profileActive}
        aria-label={`My profile (${user?.name || user?.email})`}
        className={`flex items-center gap-2 rounded-xl border px-2 py-1 text-left hover:bg-stone-50 ${profileActive ? 'border-trail-forest bg-white' : 'border-transparent'}`}
      >
        {user?.picture && <img src={user.picture} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />}
        <div className="leading-tight">
          <div className="text-sm font-medium">{user?.name || user?.email}</div>
          {backend && backend !== 'ok' && <div className="text-xs text-red-700" title={backend}>backend: {backend}</div>}
        </div>
      </button>
      <button
        onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
        className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs hover:bg-stone-50"
      >
        Log out
      </button>
    </div>
  )
}
