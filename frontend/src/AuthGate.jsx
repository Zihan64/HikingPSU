import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import Landing from './landing/Landing'

// Signed out → sign-in page. Signed in (or "browse without an account") → the app.
// Only rendered when Auth0 is configured (see main.jsx); otherwise the app opens directly as before.

const GUEST_KEY = 'hikingpsu.guest'
const readGuest = () => { try { return sessionStorage.getItem(GUEST_KEY) === '1' } catch { return false } }
const writeGuest = on => { try { on ? sessionStorage.setItem(GUEST_KEY, '1') : sessionStorage.removeItem(GUEST_KEY) } catch { /* private mode */ } }

function describeError(e) {
  if (!e) return null
  switch (e.error) {
    case 'popup_open':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site, then select Sign in again.'
    case 'cancelled':
      return 'The sign-in window was closed before sign-in finished. Select Sign in to try again.'
    case 'timeout':
      return 'Sign-in timed out. Select Sign in to try again.'
    default:
      return `Sign-in didn’t finish: ${e.error_description || e.message || 'unknown error'}`
  }
}

export default function AuthGate({ children }) {
  const { isLoading, isAuthenticated, error, loginWithPopup } = useAuth0()
  const [checked, setChecked] = useState(false) // first session check finished
  const [busy, setBusy] = useState(false)       // pop-up open
  const [shownError, setShownError] = useState(null)
  const [guest, setGuest] = useState(readGuest)

  // isLoading also turns true while the pop-up is open, so it only gates the very first render.
  useEffect(() => { if (!isLoading) setChecked(true) }, [isLoading])
  useEffect(() => { if (error) setShownError(error) }, [error])
  useEffect(() => { if (isAuthenticated) writeGuest(false) }, [isAuthenticated])

  async function open(screenHint) {
    setShownError(null)
    setBusy(true)
    try {
      // loginWithPopup never throws; failures land in `error` above.
      await loginWithPopup(screenHint ? { authorizationParams: { screen_hint: screenHint } } : undefined)
    } finally {
      setBusy(false)
    }
  }

  if (!checked) return <div className="lp-sky min-h-screen" aria-busy="true" />
  if (isAuthenticated || guest) return children

  return (
    <Landing
      onSignIn={() => open()}
      onSignUp={() => open('signup')}
      onGuest={() => { writeGuest(true); setGuest(true) }}
      busy={busy}
      error={describeError(shownError)}
    />
  )
}
