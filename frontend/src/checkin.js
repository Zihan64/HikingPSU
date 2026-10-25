// Trailhead check-ins and badges: pure helpers, no React, no network.
// The server checks distance, timing and limits; these only drive the UI.
import { createLocationController, formatAccuracy } from './location.js'

export const CHECKIN_RADIUS_M = 200
export const CHECKIN_ACCURACY_M = 100   // the server refuses fixes less accurate than this
export const DAILY_LIMIT = 2     // completed trails per day (State College time)
export const REPEAT_TARGET = 5   // the same trail this many times earns the special badge
export const TIER_EMOJI = { bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💎', special: '⭐' }
export const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', special: 'Special' }

function abortError() {
  const err = new Error('Location request cancelled.')
  err.name = 'AbortError'
  return err
}

// A location fix for a check-in, built on the same controller as the map (high accuracy, then one
// standard-accuracy retry). Keeps watching until a fix is within `maxAccuracy` metres, so a coarse
// first fix (cell tower, GPS still settling) isn't sent; gives up after `timeoutMs`, which also
// covers a permission prompt that is never answered. Resolves {latitude, longitude, accuracy};
// rejects with a user-facing message. The controller is always disconnected afterwards.
export function requestOneFix({ geolocation, permissions, secureContext, policyAllowed = true, signal,
  maxAccuracy = CHECKIN_ACCURACY_M, timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return }
    const controller = createLocationController({ geolocation, permissions, secureContext, policyAllowed })
    const disconnect = controller.connect()
    let unsubscribe = () => {}
    let settled = false
    let best = null   // most accurate fix so far, when none is good enough yet
    function settle(fn, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      disconnect()
      signal?.removeEventListener('abort', onAbort)
      fn(value)
    }
    const tooCoarse = () => new Error(`Your location is only accurate to about ${formatAccuracy(best.accuracy)}. Check-in needs ${maxAccuracy} m or better: move into the open, turn on precise location and Wi-Fi, then try again.`)
    function check() {
      const { status, position, error } = controller.getSnapshot()
      if (position && (!best || position.accuracy < best.accuracy)) best = position
      if (best && best.accuracy <= maxAccuracy) settle(resolve, { latitude: best.latitude, longitude: best.longitude, accuracy: best.accuracy })
      else if (status === 'denied' || status === 'unavailable') settle(reject, new Error(error || 'Your location is unavailable. Try again.'))
      else if (status === 'error') settle(reject, best ? tooCoarse() : new Error(error || 'Your location is unavailable. Try again.'))
    }
    function onTimeout() {
      settle(reject, best ? tooCoarse() : new Error("Couldn't get your location in time. If your browser asked for permission, allow location, then try again outdoors."))
    }
    function onAbort() { settle(reject, abortError()) }
    const timer = setTimeout(onTimeout, timeoutMs)
    signal?.addEventListener('abort', onAbort)
    unsubscribe = controller.subscribe(check)
    controller.startTracking()   // keep watching past a coarse first fix
    check()  // 'unavailable' is reported without a state change
  })
}

// When an active check-in can be finished. Unparseable times defer to the server.
export function checkinTiming(checkin, nowMs = Date.now()) {
  const finishAt = Date.parse(checkin?.finish_after)
  const expiresAt = Date.parse(checkin?.expires_at)
  const expired = Number.isFinite(expiresAt) && nowMs >= expiresAt
  const msUntilFinish = Number.isFinite(finishAt) ? Math.max(0, finishAt - nowMs) : 0
  const active = !checkin?.status || checkin.status === 'active'
  return { canFinish: active && !expired && msUntilFinish === 0, msUntilFinish, expired }
}

// "I finished this trail" finishes the check-in (badge + hike log) when it's on that trail and finishable.
export function finishesCheckin(checkin, trailId, nowMs = Date.now()) {
  return !!checkin && checkin.trail_id === trailId && checkinTiming(checkin, nowMs).canFinish
}

// "3:05 PM" in the viewer's locale and time zone (locale/timeZone are for tests). `ceil` rounds up
// to the next whole minute, so "finish after" never shows a time before the real one.
export function formatClock(iso, { locale, timeZone, ceil = false } = {}) {
  let date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (ceil) date = new Date(Math.ceil(date.getTime() / 60000) * 60000)
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) })
}

// Shortest hike the server accepts: 40% of the estimated time, at least 15 minutes.
export function minHikeMinutes(estTimeMin) {
  const est = Number(estTimeMin)
  return Math.max(15, Number.isFinite(est) ? Math.ceil(est * 0.4) : 0)
}

// Next distinct-trail milestone not yet earned, or null when all are.
export function nextMilestone(board) {
  const next = [...(board?.milestones || [])].sort((a, b) => a.count - b.count).find(m => !m.earned)
  return next ? { count: next.count, remaining: Math.max(0, next.count - (board.completed_trails || 0)) } : null
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
