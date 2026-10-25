import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { cancelCheckin, startCheckin } from './api'
import { AUTH_ENABLED, useOptionalToken } from './auth'
import { CHECKIN_RADIUS_M, DAILY_LIMIT, checkinTiming, formatClock, minHikeMinutes, requestOneFix } from './checkin'
import useNow from './useNow'

// Same browser inputs useLocation passes to the map's location controller.
const browserLocation = () => ({
  geolocation: navigator.geolocation,
  permissions: navigator.permissions,
  secureContext: window.isSecureContext,
  policyAllowed: (document.permissionsPolicy || document.featurePolicy)?.allowsFeature('geolocation') ?? true,
})

const BUSY_LABEL = { locating: 'Getting your location…', saving: 'Checking you in…', cancelling: 'Cancelling…' }

// Trail page: check in at the trailhead, then finish with a rating for a badge.
// checkin: the user's active check-in (any trail) or null. onChange(next) replaces it,
// onRefresh() reloads it from the server, onFinish(checkin) opens the rating flow.
export default function CheckinControl({ trail, checkin, onChange = () => {}, onRefresh = () => {}, onFinish = () => {} }) {
  const { isAuthenticated, loginWithPopup } = useAuth0()
  const getToken = useOptionalToken()
  const signedIn = AUTH_ENABLED && isAuthenticated
  const [busy, setBusy] = useState(null)   // 'locating' | 'saving' | 'cancelling'
  const [error, setError] = useState(null)
  const [authLost, setAuthLost] = useState(false)   // token missing or rejected: offer to log in again
  const [notice, setNotice] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const pending = useRef(null)
  const heading = useRef(null), refocus = useRef(false)
  const now = useNow(30000, Boolean(signedIn && checkin), Date.parse(checkin?.finish_after))
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    setError(null); setAuthLost(false)
    // The button that started or cancelled the check-in is gone; keep keyboard focus in this section.
    if (refocus.current) { refocus.current = false; heading.current?.focus({ preventScroll: true }) }
  }, [checkin?.id])

  // Never send the request without a token: a failed silent refresh means logging in again.
  async function token() {
    const value = await getToken()
    if (!value) throw Object.assign(new Error('authentication required'), { status: 401 })
    return value
  }

  function fail(err) {
    if (err.status === 401) { setAuthLost(true); setError('Your login has expired. Log in again to continue.') }
    else setError(err.message)
  }

  async function start() {
    if (busy) return
    const abort = new AbortController()
    pending.current = abort
    setBusy('locating'); setError(null); setAuthLost(false); setAnnouncement('')
    try {
      const fix = await requestOneFix({ ...browserLocation(), signal: abort.signal })
      setBusy('saving')
      const created = await startCheckin({ trail_id: trail.id, lat: fix.latitude, lon: fix.longitude, accuracy_m: fix.accuracy }, await token())
      setAnnouncement(`Checked in at ${created.trail_name}. You can finish after ${formatClock(created.finish_after, { ceil: true })}.`)
      refocus.current = true
      onChange(created)
    } catch (err) {
      if (abort.signal.aborted) return
      fail(err)
      if (err.status === 409) onRefresh()   // already checked in somewhere: show that check-in
    } finally {
      if (pending.current === abort) pending.current = null
      if (!abort.signal.aborted) setBusy(null)
    }
  }

  function stopLocating() {
    pending.current?.abort(); pending.current = null
    setBusy(null)
  }

  async function cancel(target) {
    if (busy || !confirm(`Cancel your check-in at ${target.trail_name}? You'll need to check in again at the trailhead.`)) return
    setBusy('cancelling'); setError(null); setAuthLost(false); setAnnouncement('')
    try {
      await cancelCheckin(target.id, await token())
      setAnnouncement('Check-in cancelled.')
      refocus.current = true
      onChange(null)
    }
    catch (err) { fail(err); if (err.status === 404) onRefresh() }
    finally { setBusy(null) }
  }

  function logInAgain() {
    loginWithPopup().then(() => { setAuthLost(false); setError(null); onRefresh() }, () => {})
  }

  function signIn() {
    if (!AUTH_ENABLED) { setNotice("Sign-in is unavailable in this preview. Open the configured HikingPSU site to log in."); return }
    loginWithPopup()
  }

  let body
  if (!signedIn) {
    body = <>
      <p>Log in to check in at the trailhead and earn badges.</p>
      <button className="primary-button" onClick={signIn}>Log in</button>
      {notice && <p className="catalog-muted" role="alert">{notice}</p>}
    </>
  } else if (!checkin) {
    body = <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button className="primary-button" onClick={start} disabled={!!busy} aria-describedby="checkin-privacy">{BUSY_LABEL[busy] || 'Start hike · check in'}</button>
        {busy === 'locating' && <button className="text-button" onClick={stopLocating}>Stop</button>}
      </div>
      <p id="checkin-privacy" className="catalog-muted">We use one location fix to confirm you're within {CHECKIN_RADIUS_M} m of an entrance. We keep the distance, not your coordinates.</p>
      <p className="catalog-muted">Finish & rate after at least {minHikeMinutes(trail.difficulty?.est_time_min)} min on the trail · up to {DAILY_LIMIT} trails a day · a check-in lasts 24 hours.</p>
    </>
  } else {
    const timing = checkinTiming(checkin, now)
    const when = timing.expired ? 'This check-in has expired. Check in again at the trailhead.'
      : timing.canFinish ? 'You can finish now.' : `You can finish after ${formatClock(checkin.finish_after, { ceil: true })}.`
    body = checkin.trail_id === trail.id ? <>
      <p>Checked in at {formatClock(checkin.started_at)}. {when}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button className="primary-button" disabled={!timing.canFinish || !!busy} onClick={() => onFinish(checkin)}>Finish & rate</button>
        <button className="text-button" disabled={!!busy} onClick={() => cancel(checkin)}>{busy === 'cancelling' ? BUSY_LABEL.cancelling : 'Cancel check-in'}</button>
      </div>
    </> : <>
      <p>You're checked in at <b>{checkin.trail_name}</b>. Finish or cancel that hike first.</p>
      <div className="flex flex-wrap items-center gap-x-4">
        <button className="text-button" disabled={!timing.canFinish || !!busy} onClick={() => onFinish(checkin)}>
          {timing.canFinish ? `Finish & rate ${checkin.trail_name}` : `Finish ${checkin.trail_name} after ${formatClock(checkin.finish_after, { ceil: true })}`}
        </button>
        <button className="text-button" disabled={!!busy} onClick={() => cancel(checkin)}>Cancel that check-in</button>
      </div>
    </>
  }

  return <section className="catalog-section checkin-control" aria-labelledby="checkin-title">
    <h2 id="checkin-title" ref={heading} tabIndex={-1}>Hike it for a badge</h2>
    {body}
    <span className="sr-only" role="status" aria-live="polite">{BUSY_LABEL[busy] || announcement}</span>
    {error && <p className="error-message mt-3" role="alert">{error}</p>}
    {error && authLost && <button className="primary-button mt-2" onClick={logInAgain}>Log in again</button>}
  </section>
}
