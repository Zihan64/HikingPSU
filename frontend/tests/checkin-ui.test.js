import test, { before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')
const { create, act } = require('react-test-renderer')
const { Auth0Context, initialContext } = require('@auth0/auth0-react')

let ui, tree, requests, responses, watches, saved, confirmAnswer, logins
const savedGlobals = {}
const trail = { id: 't1', name: 'Forest Loop', difficulty: { level: 1, est_time_min: 55 } }
const minutes = n => new Date(Date.now() + n * 60000).toISOString()
const activeCheckin = (overrides = {}) => ({ id: 'c1', trail_id: 't1', trail_name: 'Forest Loop', status: 'active',
  started_at: minutes(-10), finish_after: minutes(15), expires_at: minutes(23 * 60), completed_at: null, distance_m: 40, ...overrides })

before(async () => {
  const outfile = new URL('../node_modules/.cache/checkin-ui-tests/components.mjs', import.meta.url)
  await mkdir(fileURLToPath(new URL('./', outfile)), { recursive: true })
  await build({
    stdin: { resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'js', contents: `
      export { default as CheckinControl } from './CheckinControl.jsx'
      export { default as ReviewModal } from './ReviewModal.jsx'
      export { default as ActiveCheckinBanner } from './ActiveCheckinBanner.jsx'
      export { default as Dashboard } from './Dashboard.jsx'` },
    outfile: fileURLToPath(outfile), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', '@auth0/auth0-react'],
    define: { 'import.meta.env': JSON.stringify({ VITE_AUTH0_DOMAIN: 'test.auth0.invalid', VITE_AUTH0_CLIENT_ID: 'synthetic-client', VITE_AUTH0_AUDIENCE: 'https://api.test.invalid' }) },
  })
  ui = await import(outfile.href)
})

beforeEach(() => {
  requests = []; responses = {}; watches = []; saved = []; confirmAnswer = true; logins = 0
  for (const key of ['fetch', 'navigator', 'window', 'document', 'confirm']) savedGlobals[key] = Object.getOwnPropertyDescriptor(globalThis, key)
  const set = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  set('navigator', { geolocation: { watchPosition(success, error, options) { watches.push({ success, error, options }); return watches.length - 1 }, clearWatch() {} } })
  set('window', { isSecureContext: true, addEventListener() {}, removeEventListener() {} })
  set('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
  set('confirm', () => confirmAnswer)
  set('fetch', async (url, options = {}) => {
    const method = options.method || 'GET'
    requests.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined, auth: options.headers?.Authorization })
    const [status, body] = responses[`${method} ${url}`] || (url.includes('/reviews') ? [200, { summary: { count: 0 }, reviews: [] }] : [404, { detail: 'Not found' }])
    return { ok: status < 300, status, json: async () => body }
  })
})

afterEach(async () => {
  if (tree) await act(async () => tree.unmount())
  tree = null
  for (const [key, descriptor] of Object.entries(savedGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

const session = (overrides = {}) => ({ ...initialContext, isAuthenticated: true, isLoading: false,
  getAccessTokenSilently: async () => 'synthetic-test-token', loginWithPopup: async () => { logins++ }, loginWithRedirect: async () => {}, ...overrides })
async function mount(component, props, auth = session()) {
  await act(async () => { tree = create(React.createElement(Auth0Context.Provider, { value: auth }, React.createElement(component, props))) })
}
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('')
const button = label => tree.root.findAllByType('button').find(b => text(b).includes(label))
const alerts = () => tree.root.findAllByProps({ role: 'alert' }).map(text)
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const controlProps = (overrides = {}) => ({ trail, checkin: null, onChange: c => saved.push(['change', c]), onRefresh: () => saved.push(['refresh']), onFinish: c => saved.push(['finish', c]), ...overrides })

test('signed out: explains check-ins and logs in with the Auth0 pop-up', async () => {
  await mount(ui.CheckinControl, controlProps(), session({ isAuthenticated: false }))
  assert.match(text(tree.root), /Log in to check in at the trailhead and earn badges/)
  await act(async () => button('Log in').props.onClick())
  assert.equal(logins, 1)
  assert.equal(button('Start hike'), undefined)
})

test('start: one location fix, then a check-in POST with distance inputs only', async () => {
  const created = activeCheckin()
  responses['POST /api/me/checkins'] = [201, created]
  await mount(ui.CheckinControl, controlProps())
  assert.match(text(tree.root), /within 200 m of an entrance\. We keep the distance, not your coordinates/)
  assert.match(text(tree.root), /at least 22 min/)
  await act(async () => { button('Start hike · check in').props.onClick() })
  assert.ok(button('Getting your location…').props.disabled)
  assert.equal(watches.length, 1)
  assert.equal(watches[0].options.enableHighAccuracy, true)
  await act(async () => { watches[0].success({ coords: { latitude: 40.8, longitude: -77.8, accuracy: 18 } }) })
  await flush()
  const post = requests.find(r => r.method === 'POST')
  assert.equal(post.url, '/api/me/checkins')
  assert.deepEqual(post.body, { trail_id: 't1', lat: 40.8, lon: -77.8, accuracy_m: 18 })
  assert.equal(post.auth, 'Bearer synthetic-test-token')
  assert.deepEqual(saved, [['change', created]])
  assert.match(text(tree.root.findByProps({ role: 'status' })), /Checked in at Forest Loop\. You can finish after .+\./)
})

test('start: a coarse fix is not sent; Stop ends a location request that never settles', async () => {
  await mount(ui.CheckinControl, controlProps())
  await act(async () => { button('Start hike').props.onClick() })
  await act(async () => { watches[0].success({ coords: { latitude: 40.8, longitude: -77.8, accuracy: 1400 } }) })
  await flush()
  assert.equal(requests.length, 0)
  assert.ok(button('Getting your location…').props.disabled)
  await act(async () => button('Stop').props.onClick())
  assert.ok(!button('Start hike').props.disabled)
  assert.equal(button('Stop'), undefined)
  assert.deepEqual(alerts(), [])
})

test('start/cancel without a usable token: nothing is sent and the user can log in again', async () => {
  const refreshed = []
  await mount(ui.CheckinControl, controlProps({ onRefresh: () => refreshed.push(1) }), session({ getAccessTokenSilently: async () => { throw new Error('login_required') } }))
  await act(async () => { button('Start hike').props.onClick() })
  await act(async () => { watches[0].success({ coords: { latitude: 40.8, longitude: -77.8, accuracy: 18 } }) })
  await flush()
  assert.equal(requests.length, 0)
  assert.match(alerts().join(), /login has expired/)
  await act(async () => button('Log in again').props.onClick())
  assert.equal(logins, 1)
  assert.equal(button('Log in again'), undefined)
  assert.deepEqual(refreshed, [1])
  await act(async () => tree.unmount()); tree = null

  responses['DELETE /api/me/checkins/c1'] = [401, { detail: 'authentication required' }]
  await mount(ui.CheckinControl, controlProps({ checkin: activeCheckin() }))
  await act(async () => button('Cancel check-in').props.onClick())
  assert.match(alerts().join(), /login has expired/)
  assert.ok(button('Log in again'))
})

test('start: server and location errors are shown; a conflict refreshes the active check-in', async () => {
  responses['POST /api/me/checkins'] = [422, { detail: "You're about 850 m from the nearest entrance of Forest Loop. Check in within 200 m." }]
  await mount(ui.CheckinControl, controlProps())
  await act(async () => { button('Start hike').props.onClick() })
  await act(async () => { watches[0].success({ coords: { latitude: 40.8, longitude: -77.8, accuracy: 18 } }) })
  await flush()
  assert.match(alerts().join(), /about 850 m/)
  assert.ok(!button('Start hike').props.disabled)

  responses['POST /api/me/checkins'] = [409, { detail: 'You already have an active check-in at Lake Walk.' }]
  await act(async () => { button('Start hike').props.onClick() })
  await act(async () => { watches[1].success({ coords: { latitude: 40.8, longitude: -77.8, accuracy: 18 } }) })
  await flush()
  assert.match(alerts().join(), /active check-in at Lake Walk/)
  assert.deepEqual(saved, [['refresh']])

  await act(async () => { button('Start hike').props.onClick() })
  await act(async () => { watches[2].error({ code: 1 }) })
  await flush()
  assert.match(alerts().join(), /not allowed/)
  assert.equal(requests.filter(r => r.method === 'POST').length, 2)
})

test('active here: finish waits for finish_after; cancel confirms and deletes', async () => {
  await mount(ui.CheckinControl, controlProps({ checkin: activeCheckin() }))
  assert.match(text(tree.root), /Checked in at .+\. You can finish after .+\./)
  assert.equal(button('Finish & rate').props.disabled, true)
  confirmAnswer = false
  await act(async () => button('Cancel check-in').props.onClick())
  assert.equal(requests.length, 0)
  confirmAnswer = true
  responses['DELETE /api/me/checkins/c1'] = [204, null]
  await act(async () => button('Cancel check-in').props.onClick())
  assert.deepEqual(requests.map(r => `${r.method} ${r.url}`), ['DELETE /api/me/checkins/c1'])
  assert.deepEqual(saved, [['change', null]])
  assert.equal(text(tree.root.findByProps({ role: 'status' })), 'Check-in cancelled.')

  const ready = activeCheckin({ finish_after: minutes(-1) })
  await act(async () => tree.update(React.createElement(Auth0Context.Provider, { value: session() }, React.createElement(ui.CheckinControl, controlProps({ checkin: ready })))))
  assert.match(text(tree.root), /You can finish now/)
  await act(async () => button('Finish & rate').props.onClick())
  assert.deepEqual(saved.at(-1), ['finish', ready])
})

test('active elsewhere: points to the other trail instead of offering a new check-in', async () => {
  const other = activeCheckin({ trail_id: 't2', trail_name: 'Lake Walk', finish_after: minutes(-5) })
  await mount(ui.CheckinControl, controlProps({ checkin: other }))
  assert.match(text(tree.root), /You're checked in at Lake Walk\. Finish or cancel that hike first\./)
  assert.equal(button('Start hike'), undefined)
  await act(async () => button('Finish & rate Lake Walk').props.onClick())
  assert.deepEqual(saved, [['finish', other]])
})

test('banner: names the hike, waits, then offers Finish & rate', async () => {
  const calls = []
  await mount(ui.ActiveCheckinBanner, { checkin: activeCheckin(), onFinish: () => calls.push('finish'), onView: () => calls.push('view') })
  assert.match(text(tree.root), /On the trail: Forest Loop · finish after /)
  assert.equal(button('Finish & rate').props.disabled, true)
  await act(async () => button('View trail').props.onClick())
  await act(async () => tree.update(React.createElement(Auth0Context.Provider, { value: session() },
    React.createElement(ui.ActiveCheckinBanner, { checkin: activeCheckin({ finish_after: minutes(-1) }), onFinish: () => calls.push('finish') }))))
  assert.match(text(tree.root), /· ready to finish/)
  assert.equal(button('View trail'), undefined)
  await act(async () => button('Finish & rate').props.onClick())
  assert.deepEqual(calls, ['view', 'finish'])
  await act(async () => tree.update(React.createElement(Auth0Context.Provider, { value: session() },
    React.createElement(ui.ActiveCheckinBanner, { checkin: activeCheckin({ finish_after: minutes(-60), expires_at: minutes(-1) }), onFinish() {} }))))
  assert.match(text(tree.root), /On the trail: Forest Loop · check-in expired/)
  assert.equal(button('Finish & rate'), undefined)
})

async function rate() {
  for (const group of tree.root.findAllByProps({ role: 'radiogroup' })) {
    await act(async () => group.findAllByProps({ role: 'radio' })[3].props.onClick())
  }
}

test('finish mode: ratings complete the hike and the new badges are shown', async () => {
  const checkin = activeCheckin({ finish_after: minutes(-1) })
  const badge = { key: 'trail:t1', kind: 'trail', tier: 'bronze', title: 'Forest Loop', description: 'Completed Forest Loop', target_id: 't1', awarded_at: minutes(0) }
  responses['POST /api/me/checkins/c1/finish'] = [200, { checkin: { ...checkin, status: 'completed' }, review: {}, new_badges: [badge] }]
  const events = []
  await mount(ui.ReviewModal, { trail, checkin, onClose: () => events.push('close'), onSaved: () => events.push('saved'), onCheckinDone: r => events.push(['done', r.new_badges.length]) })
  await flush()
  assert.match(text(tree.root), /Finish Forest Loop and rate it/)
  assert.match(text(tree.root), /Rate all three to complete your hike and log it toward your badges\. A comment is optional\./)
  assert.equal(button('Finish hike').props.disabled, true)
  await rate()
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  const post = requests.find(r => r.method === 'POST')
  assert.equal(post.url, '/api/me/checkins/c1/finish')
  assert.deepEqual(post.body, { accuracy: 4, difficulty: 4, enjoyment: 4, comment: null })
  assert.deepEqual(events, ['saved', ['done', 1]])   // stays open on the result view
  assert.match(text(tree.root), /🥉/)
  assert.match(text(tree.root), /Completed Forest Loop/)
  await act(async () => button('Close').props.onClick())
  assert.deepEqual(events.at(-1), 'close')
})

test('finish mode: no new badge, too early and server refusals', async () => {
  const early = activeCheckin()
  await mount(ui.ReviewModal, { trail, checkin: early, onClose() {}, onSaved() {}, onCheckinDone: r => saved.push(['done', r]) })
  await flush()
  await rate()
  assert.match(text(tree.root), /You can finish after /)
  assert.equal(button('Finish hike').props.disabled, true)
  assert.equal(button('Delete my review'), undefined)
  await act(async () => tree.unmount()); tree = null

  const checkin = activeCheckin({ finish_after: minutes(-1) })
  responses['POST /api/me/checkins/c1/finish'] = [429, { detail: "You've completed 2 trails today. Come back tomorrow." }]
  await mount(ui.ReviewModal, { trail, checkin, onClose() {}, onSaved() {}, onCheckinDone: r => saved.push(['done', r]) })
  await flush()
  await rate()
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.match(alerts().join(), /completed 2 trails today/)
  assert.deepEqual(saved, [])
  responses['POST /api/me/checkins/c1/finish'] = [409, { detail: 'This check-in is no longer active.' }]
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.match(alerts().join(), /no longer active/)
  assert.deepEqual(saved, [['done', null]])
  responses['POST /api/me/checkins/c1/finish'] = [200, { checkin, review: {}, new_badges: [] }]
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.match(text(tree.root), /Hike logged! You already have this trail's badge — keep going\./)
})

test('finish mode still works when the earlier review cannot be loaded', async () => {
  const checkin = activeCheckin({ finish_after: minutes(-1) })
  responses['GET /api/trails/t1/reviews'] = [500, { detail: 'Reviews are down' }]
  responses['POST /api/me/checkins/c1/finish'] = [200, { checkin: { ...checkin, status: 'completed' }, review: {}, new_badges: [] }]
  await mount(ui.ReviewModal, { trail, checkin, onClose() {}, onSaved() {}, onCheckinDone() {} })
  await flush()
  assert.doesNotMatch(text(tree.root), /Reviews are down/)
  await rate()
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.ok(requests.some(r => r.method === 'POST' && r.url === '/api/me/checkins/c1/finish'))
  assert.match(text(tree.root), /Hike logged!/)
})

test('review mode without the badge hint when already checked in on that trail', async () => {
  await mount(ui.ReviewModal, { trail, badgeHint: false, onClose() {}, onSaved() {} })
  await flush()
  assert.match(text(tree.root), /How was Forest Loop\?/)
  assert.doesNotMatch(text(tree.root), /Want a badge\?/)
})

test('review mode is unchanged apart from the badge hint', async () => {
  responses['PUT /api/trails/t1/reviews/me'] = [200, {}]
  const events = []
  await mount(ui.ReviewModal, { trail, onClose: () => events.push('close'), onSaved: () => events.push('saved') })
  await flush()
  assert.match(text(tree.root), /How was Forest Loop\?/)
  assert.match(text(tree.root), /Want a badge\? Start a check-in from the trail page when you're at the trailhead\./)
  await rate()
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.deepEqual(requests.filter(r => r.method !== 'GET').map(r => `${r.method} ${r.url}`), ['PUT /api/trails/t1/reviews/me'])
  assert.deepEqual(events, ['saved', 'close'])
})

const me = { profile: { age: null, home_area: null, fitness: null, group_type: null }, preferences: { transit_modes: [], max_drive_min: null, max_time_min: null, preferred_features: [], avoid: [], max_level: null, prefers_loop: null, preferred_seasons: [] } }
const insights = { stats: { total_hikes: 0, unique_trails: 0, total_distance_mi: 0, total_elevation_gain_ft: 0 }, profile_completeness: 10, level_counts: {}, feature_affinity: {}, felt_vs_official: null, comfortable_level: null, avg_rating: null, season_counts: {}, top_areas: [] }
function profileResponses(board) {
  responses['GET /api/me'] = [200, me]
  responses['GET /api/me/insights'] = [200, insights]
  responses['GET /api/me/hikes?limit=200'] = [200, []]
  if (board) responses['GET /api/me/badges'] = [200, board]
}

test('profile badges: earned badges, milestone, park and repeat progress', async () => {
  profileResponses({
    badges: [{ key: 'm10', kind: 'milestone', tier: 'gold', title: '10 trails', description: 'Completed 10 different trails', target_id: null, awarded_at: '2026-10-20T15:00:00Z' }],
    completed_trails: 12, total_trails: 40, milestones: [{ count: 10, earned: true }, { count: 30, earned: false }],
    parks: [{ park_id: 'rothrock', name: 'Rothrock State Forest', completed: 3, total: 3, earned: true }, { park_id: 'lake', name: 'Lake Park', completed: 1, total: 4, earned: false }],
    repeats: [{ trail_id: 't1', trail_name: 'Forest Loop', count: 3 }], today_remaining: 1,
  })
  await mount(ui.Dashboard, { trails: [] })
  await flush()
  const page = text(tree.root)
  assert.match(page, /12 of 40 trails completed with a check-in/)
  assert.match(page, /not hikes you log by hand/)
  assert.match(page, /18 more trails to the 30-trail badge/)
  assert.match(page, /You can complete 1 more trail today\./)
  assert.match(page, /🥇/)
  assert.match(page, /Completed 10 different trails/)
  assert.match(page, /Rothrock State Forest3\/3✓/)
  assert.match(page, /Lake Park1\/4/)
  assert.match(page, /Forest Loop3 of 5/)
  assert.ok(page.indexOf('Badges') < page.indexOf('About you'))
})

test('profile badges: empty state, and a badge outage leaves the profile usable', async () => {
  profileResponses({ badges: [], completed_trails: 0, total_trails: 40, milestones: [{ count: 10, earned: false }, { count: 30, earned: false }], parks: [], repeats: [], today_remaining: 2 })
  await mount(ui.Dashboard, { trails: [] })
  await flush()
  assert.match(text(tree.root), /Check in at a trailhead and finish with a rating to earn your first badge\./)
  assert.match(text(tree.root), /You can complete 2 more trails today\./)
  await act(async () => tree.unmount()); tree = null

  profileResponses(null)
  responses['GET /api/me/badges'] = [503, { detail: 'Badges are unavailable' }]
  await mount(ui.Dashboard, { trails: [] })
  await flush()
  assert.match(alerts().join(), /Couldn't load your badges: Badges are unavailable/)
  assert.match(text(tree.root), /About you/)
})
