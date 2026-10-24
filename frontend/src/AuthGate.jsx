import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import Landing from './landing/Landing'

// Sign-in page ⇄ app, wired to the browser history:
//   - entering the app (sign-in, "browse without an account", or a returning session) pushes a history entry,
//   - the browser Back button returns to the sign-in page, Forward goes back into the app.
// The app stays mounted (just hidden) while the sign-in page shows, so the chat and map survive Back/Forward.
// Only rendered when Auth0 is configured (see main.jsx); otherwise the app opens directly as before.

const GUEST_KEY = 'hikingpsu.guest'
const readGuest = () => { try { return sessionStorage.getItem(GUEST_KEY) === '1' } catch { return false } }
const writeGuest = on => { try { on ? sessionStorage.setItem(GUEST_KEY, '1') : sessionStorage.removeItem(GUEST_KEY) } catch { /* private mode */ } }

const VIEW_KEY = 'hikingpsuView'
const historyView = () => { try { return window.history.state?.[VIEW_KEY] ?? null } catch { return null } }
const markHistory = (view, push) => {
  try {
    const state = { ...(push ? {} : window.history.state || {}), [VIEW_KEY]: view }
    push ? window.history.pushState(state, '') : window.history.replaceState(state, '')
  } catch { /* history unavailable (sandboxed preview): stay in-memory */ }
}

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
  const { isLoading, isAuthenticated, user, error, loginWithPopup, logout } = useAuth0()
  const [checked, setChecked] = useState(false) // first session check finished
  const [busy, setBusy] = useState(false)       // pop-up open
  const [shownError, setShownError] = useState(null)
  const [guest, setGuest] = useState(readGuest)
  const [view, setView] = useState('landing')   // 'landing' | 'app'
  const [appMounted, setAppMounted] = useState(false)
  const allowed = isAuthenticated || guest
  const allowedRef = useRef(allowed)
  allowedRef.current = allowed

  // isLoading also turns true while the pop-up is open, so it only gates the very first render.
  useEffect(() => { if (!isLoading) setChecked(true) }, [isLoading])
  useEffect(() => { if (error) setShownError(error) }, [error])
  useEffect(() => { if (isAuthenticated) writeGuest(false) }, [isAuthenticated])

  function enterApp() {
    if (historyView() !== 'app') markHistory('app', true)
    setAppMounted(true)
    setView('app')
  }

  // First render after the session check: decide where this history entry belongs.
  useEffect(() => {
    if (!checked) return
    const v = historyView()
    if (v === 'app' && allowed) { setAppMounted(true); setView('app') }
    else if (v === null && allowed) { markHistory('landing', false); enterApp() } // returning visitor: leave a sign-in entry behind
    else { markHistory('landing', false); setView('landing') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked])

  // Back / Forward.
  useEffect(() => {
    const onPop = e => {
      const v = e.state?.[VIEW_KEY]
      if (v === 'app' && allowedRef.current) { setAppMounted(true); setView('app') }
      else setView('landing')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Leaflet measures its container on window resize; nudge it after the app becomes visible again.
  useEffect(() => {
    if (view === 'app') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }, [view])

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

  // Signed in through the pop-up while the sign-in page is showing: go straight into the app.
  const wasAuthenticated = useRef(isAuthenticated)
  useEffect(() => {
    if (checked && isAuthenticated && !wasAuthenticated.current && view === 'landing') enterApp()
    wasAuthenticated.current = isAuthenticated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, checked])

  if (!checked) return <div className="lp-sky min-h-screen" aria-busy="true" />

  const showLanding = view === 'landing' || !allowed
  return (
    <>
      {showLanding && (
        <Landing
          onSignIn={() => open()}
          onSignUp={() => open('signup')}
          onGuest={() => { writeGuest(true); setGuest(true); enterApp() }}
          guestReturning={guest && !isAuthenticated}
          signedInName={isAuthenticated ? (user?.name || user?.email || 'your account') : null}
          onContinue={enterApp}
          onSignOut={() => { writeGuest(false); logout({ logoutParams: { returnTo: window.location.origin } }) }}
          busy={busy}
          error={describeError(shownError)}
        />
      )}
      {/* display: contents keeps .app-shell a direct layout child of #root, exactly as before */}
      {appMounted && allowed && <div style={{ display: showLanding ? 'none' : 'contents' }}>{children}</div>}
    </>
  )
}
