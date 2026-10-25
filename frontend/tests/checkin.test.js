import test from 'node:test'
import assert from 'node:assert/strict'
import { checkinTiming, formatClock, minHikeMinutes, nextMilestone, plural, requestOneFix } from '../src/checkin.js'

const fix = { coords: { latitude: 40.7934, longitude: -77.86, accuracy: 24 }, timestamp: 1700000000000 }

function geo() {
  const watches = []
  const cleared = []
  return {
    watches, cleared,
    geolocation: {
      watchPosition(success, error, options) { watches.push({ success, error, options }); return watches.length - 1 },
      clearWatch(id) { cleared.push(id) },
    },
  }
}

test('requestOneFix resolves one high-accuracy fix and stops watching', async () => {
  const { geolocation, watches, cleared } = geo()
  const pending = requestOneFix({ geolocation, secureContext: true })
  assert.equal(watches.length, 1)
  assert.equal(watches[0].options.enableHighAccuracy, true)
  watches[0].success(fix)
  assert.deepEqual(await pending, { latitude: 40.7934, longitude: -77.86, accuracy: 24 })
  assert.deepEqual(cleared, [0])
})

test('requestOneFix uses the standard-accuracy fallback before giving up', async () => {
  const { geolocation, watches, cleared } = geo()
  const pending = requestOneFix({ geolocation, secureContext: true })
  watches[0].error({ code: 3 })
  assert.equal(watches.length, 2)
  assert.equal(watches[1].options.enableHighAccuracy, false)
  watches[1].success({ ...fix, coords: { ...fix.coords, accuracy: 900 } })   // too coarse: keep watching
  assert.deepEqual(cleared, [0])
  watches[1].success({ ...fix, coords: { ...fix.coords, accuracy: 60 } })
  assert.equal((await pending).accuracy, 60)
  assert.deepEqual(cleared, [0, 1])
})

test('requestOneFix waits past a coarse first fix for one the server accepts', async () => {
  const { geolocation, watches, cleared } = geo()
  let settled = false
  const pending = requestOneFix({ geolocation, secureContext: true }).finally(() => { settled = true })
  watches[0].success({ ...fix, coords: { ...fix.coords, accuracy: 1400 } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(settled, false)
  assert.deepEqual(cleared, [])
  watches[0].success({ ...fix, coords: { ...fix.coords, latitude: 40.8, accuracy: 15 } })
  assert.deepEqual(await pending, { latitude: 40.8, longitude: -77.86, accuracy: 15 })
  assert.deepEqual(cleared, [0])
})

test('requestOneFix explains a fix that never gets accurate enough, or never arrives', async () => {
  const coarse = geo()
  const first = requestOneFix({ geolocation: coarse.geolocation, secureContext: true, timeoutMs: 20 })
  coarse.watches[0].success({ ...fix, coords: { ...fix.coords, accuracy: 1500 } })
  coarse.watches[0].success({ ...fix, coords: { ...fix.coords, accuracy: 900 } })
  await assert.rejects(first, /only accurate to about 900 m\. Check-in needs 100 m or better/)
  assert.deepEqual(coarse.cleared, [0])

  const failing = geo()   // a coarse fix, then both attempts give out
  const second = requestOneFix({ geolocation: failing.geolocation, secureContext: true })
  failing.watches[0].success({ ...fix, coords: { ...fix.coords, accuracy: 1500 } })
  failing.watches[0].error({ code: 3 })
  failing.watches[1].error({ code: 3 })
  await assert.rejects(second, /only accurate to about 1\.5 km/)

  const silent = geo()   // e.g. a permission prompt that is never answered
  await assert.rejects(requestOneFix({ geolocation: silent.geolocation, secureContext: true, timeoutMs: 20 }), /Couldn't get your location in time/)
  assert.deepEqual(silent.cleared, [0])
})

test('requestOneFix rejects with the controller message on denial and on failure', async () => {
  const denied = geo()
  const first = requestOneFix({ geolocation: denied.geolocation, secureContext: true })
  denied.watches[0].error({ code: 1 })
  await assert.rejects(first, /not allowed.*browser settings/)
  assert.deepEqual(denied.cleared, [0])

  const failing = geo()
  const second = requestOneFix({ geolocation: failing.geolocation, secureContext: true })
  failing.watches[0].error({ code: 2 })
  failing.watches[1].error({ code: 3 })
  await assert.rejects(second, /timed out/)
  assert.equal(failing.watches.length, 2)
})

test('requestOneFix rejects without prompting in an unsupported environment', async () => {
  const { geolocation, watches } = geo()
  await assert.rejects(requestOneFix({ geolocation, secureContext: false }), /secure connection/)
  await assert.rejects(requestOneFix({ geolocation: undefined, secureContext: true }), /does not support/)
  await assert.rejects(requestOneFix({ geolocation, secureContext: true, policyAllowed: false }), /blocked by this page/)
  assert.equal(watches.length, 0)
})

test('requestOneFix handles synchronous callbacks and ignores late ones', async () => {
  const cleared = []
  let late
  const geolocation = {
    watchPosition(success) { late = success; success(fix); return 7 },
    clearWatch(id) { cleared.push(id) },
  }
  const result = await requestOneFix({ geolocation, secureContext: true })
  assert.equal(result.latitude, 40.7934)
  assert.deepEqual(cleared, [7])
  late({ ...fix, coords: { ...fix.coords, latitude: 41 } })   // no throw, no second resolve
})

test('requestOneFix rejects on a blocked permission reported after the request', async () => {
  const { geolocation, cleared } = geo()
  let removed = false
  const permission = { state: 'denied', addEventListener() {}, removeEventListener() { removed = true } }
  await assert.rejects(requestOneFix({ geolocation, secureContext: true, permissions: { query: async () => permission } }), /blocked/)
  assert.deepEqual(cleared, [0])
  assert.equal(removed, true)
})

test('requestOneFix can be aborted, before or during the request', async () => {
  const { geolocation, watches, cleared } = geo()
  const early = new AbortController()
  early.abort()
  await assert.rejects(requestOneFix({ geolocation, secureContext: true, signal: early.signal }), { name: 'AbortError' })
  assert.equal(watches.length, 0)

  const later = new AbortController()
  const pending = requestOneFix({ geolocation, secureContext: true, signal: later.signal })
  later.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.deepEqual(cleared, [0])
  watches[0].success(fix)   // late result is ignored
})

const checkin = {
  id: 'c1', trail_id: 't1', trail_name: 'Forest Loop', status: 'active',
  started_at: '2026-10-25T18:40:00Z', finish_after: '2026-10-25T19:05:00Z', expires_at: '2026-10-26T18:40:00Z',
  completed_at: null, distance_m: 42,
}
const at = iso => Date.parse(iso)

test('checkinTiming: wait, then finish, then expire', () => {
  assert.deepEqual(checkinTiming(checkin, at('2026-10-25T18:50:00Z')), { canFinish: false, msUntilFinish: 15 * 60000, expired: false })
  assert.deepEqual(checkinTiming(checkin, at('2026-10-25T19:05:00Z')), { canFinish: true, msUntilFinish: 0, expired: false })
  assert.deepEqual(checkinTiming(checkin, at('2026-10-26T18:39:59Z')), { canFinish: true, msUntilFinish: 0, expired: false })
  assert.deepEqual(checkinTiming(checkin, at('2026-10-26T18:40:00Z')), { canFinish: false, msUntilFinish: 0, expired: true })
})

test('checkinTiming: only active check-ins can finish; bad timestamps defer to the server', () => {
  assert.equal(checkinTiming({ ...checkin, status: 'completed' }, at('2026-10-25T20:00:00Z')).canFinish, false)
  assert.equal(checkinTiming({ ...checkin, status: 'cancelled' }, at('2026-10-25T20:00:00Z')).canFinish, false)
  assert.deepEqual(checkinTiming({ ...checkin, finish_after: null, expires_at: 'soon' }, 0), { canFinish: true, msUntilFinish: 0, expired: false })
  // offsets other than Z are parsed as the same instant
  assert.equal(checkinTiming({ ...checkin, finish_after: '2026-10-25T15:05:00-04:00' }, at('2026-10-25T19:04:00Z')).msUntilFinish, 60000)
})

test('formatClock gives a short local time and tolerates bad input', () => {
  assert.equal(formatClock('2026-10-25T19:05:00Z', { locale: 'en-US', timeZone: 'America/New_York' }).replace(/\s/g, ' '), '3:05 PM')
  assert.equal(formatClock('2026-10-25T04:00:00+00:00', { locale: 'en-US', timeZone: 'UTC' }).replace(/\s/g, ' '), '4:00 AM')
  assert.equal(formatClock('not a time'), '')
  // ceil: a finish time with seconds shows the next whole minute, never an earlier one
  assert.equal(formatClock('2026-10-25T19:05:59Z', { locale: 'en-US', timeZone: 'UTC', ceil: true }).replace(/\s/g, ' '), '7:06 PM')
  assert.equal(formatClock('2026-10-25T19:05:00Z', { locale: 'en-US', timeZone: 'UTC', ceil: true }).replace(/\s/g, ' '), '7:05 PM')
})

test('minHikeMinutes is 40% of the estimate with a 15-minute floor', () => {
  assert.equal(minHikeMinutes(120), 48)
  assert.equal(minHikeMinutes(55), 22)
  assert.equal(minHikeMinutes(30), 15)
  assert.equal(minHikeMinutes(undefined), 15)
})

test('nextMilestone walks 10 then 30, then reports none', () => {
  const board = (completed, earned) => ({ completed_trails: completed, milestones: [{ count: 30, earned: earned[1] }, { count: 10, earned: earned[0] }] })
  assert.deepEqual(nextMilestone(board(3, [false, false])), { count: 10, remaining: 7 })
  assert.deepEqual(nextMilestone(board(12, [true, false])), { count: 30, remaining: 18 })
  assert.equal(nextMilestone(board(30, [true, true])), null)
  assert.equal(nextMilestone(null), null)
  assert.equal(plural(1, 'more trail'), '1 more trail')
  assert.equal(plural(2, 'more trail'), '2 more trails')
})
