import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { AUTH_ENABLED, useAuthFetch } from './auth'
import UserIdentity from './UserIdentity'

export default function AuthButton({ onProfile, profileActive }) {
  const { isLoading, isAuthenticated, user, loginWithPopup, logout, error } = useAuth0()
  const authFetch = useAuthFetch()
  const [backend, setBackend] = useState(null)
  const [loginNotice, setLoginNotice] = useState(null)
  useEffect(() => { setLoginNotice(null) }, [isAuthenticated])
  useEffect(() => {
    if (!isAuthenticated) { setBackend(null); return }
    let cancelled = false
    authFetch('/me').then(() => { if (!cancelled) setBackend('ok') })
      .catch(e => { if (!cancelled) setBackend(e.message) })
    return () => { cancelled = true }
  }, [isAuthenticated, authFetch])
  const popupHiccup = ['cancelled', 'popup_open', 'timeout'].includes(error?.error)
  const status = error && !popupHiccup ? 'Sign-in failed. Please try again.'
    : error?.error === 'popup_open' ? 'Allow pop-ups for this site to log in.'
      : backend && backend !== 'ok' ? 'Profile sync is temporarily unavailable.' : null
  function signIn() {
    if (!AUTH_ENABLED) {
      setLoginNotice('Sign-in is unavailable in this preview. Open the configured HikingPSU site to log in.')
      return
    }
    loginWithPopup()
  }
  return <UserIdentity user={user} signedIn={isAuthenticated} loading={AUTH_ENABLED && isLoading} status={status} loginNotice={loginNotice}
    onProfile={onProfile} profileActive={profileActive}
    onLogin={signIn}
    onLogout={() => logout({ logoutParams: { returnTo: window.location.origin } })} />
}
