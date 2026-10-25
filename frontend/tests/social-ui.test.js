import test, { before, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')
const { create, act } = require('react-test-renderer')
const { Auth0Context, initialContext } = require('@auth0/auth0-react')

let ui, preview, tree, requests, responses, logins, copied, opened
const savedGlobals = {}
const ORIGIN = 'https://hikingpsu.test'

async function bundle(name, env) {
  const outfile = new URL(`../node_modules/.cache/social-ui-tests/${name}.mjs`, import.meta.url)
  await mkdir(fileURLToPath(new URL('./', outfile)), { recursive: true })
  await build({
    stdin: { resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'js', contents: `
      export { default as PublicProfile } from './PublicProfile.jsx'
      export { default as Community } from './Community.jsx'
      export { CommentItem } from './Comments.jsx'
      export { default as Dashboard } from './Dashboard.jsx'
      export { ProfileLinkContext } from './profileLink.js'` },
    outfile: fileURLToPath(outfile), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', '@auth0/auth0-react'],
    define: { 'import.meta.env': JSON.stringify(env) },
  })
  return import(outfile.href)
}

before(async () => {
  ui = await bundle('components', { VITE_AUTH0_DOMAIN: 'test.auth0.invalid', VITE_AUTH0_CLIENT_ID: 'synthetic-client', VITE_AUTH0_AUDIENCE: 'https://api.test.invalid' })
  preview = await bundle('preview', {})   // no Auth0 settings: sign-in is unavailable
})

beforeEach(() => {
  requests = []; responses = {}; logins = 0; copied = []; opened = []
  for (const key of ['fetch', 'navigator', 'window', 'document']) savedGlobals[key] = Object.getOwnPropertyDescriptor(globalThis, key)
  const set = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  set('navigator', { clipboard: { writeText: async value => { copied.push(value) } } })
  set('window', { location: { origin: ORIGIN }, addEventListener() {}, removeEventListener() {} })
  set('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
  // responses: "METHOD url" -> [status, body], or a function returning (a promise of) one.
  set('fetch', async (url, options = {}) => {
    const method = options.method || 'GET'
    requests.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined, auth: options.headers?.Authorization })
    let reply = responses[`${method} ${url}`]
    if (typeof reply === 'function') reply = await reply()
    const [status, body] = reply || [404, { detail: 'Not found' }]
    return { ok: status < 300, status, json: async () => body }
  })
})

afterEach(async () => {
  mock.timers.reset()
  if (tree) await act(async () => tree.unmount())
  tree = null
  for (const [key, descriptor] of Object.entries(savedGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

const session = (overrides = {}) => ({ ...initialContext, isAuthenticated: true, isLoading: false,
  getAccessTokenSilently: async () => 'synthetic-test-token', loginWithPopup: async () => { logins++ }, loginWithRedirect: async () => {}, ...overrides })
const signedOut = () => session({ isAuthenticated: false })
const openProfile = handle => { opened.push(handle) }
// withLinks: provide the App's openProfile through ProfileLinkContext (as App does).
function element(component, props, auth, withLinks, lib = ui) {
  const inner = React.createElement(component, props)
  return React.createElement(Auth0Context.Provider, { value: auth },
    withLinks ? React.createElement(lib.ProfileLinkContext.Provider, { value: openProfile }, inner) : inner)
}
async function mount(component, props, { auth = session(), withLinks = true, lib = ui, createNodeMock } = {}) {
  await act(async () => { tree = create(element(component, props, auth, withLinks, lib), createNodeMock && { createNodeMock }) })
}
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('')
const page = () => text(tree.root)
const buttons = () => tree.root.findAllByType('button')
const button = label => buttons().find(b => text(b) === label)
const buttonWith = part => buttons().find(b => text(b).includes(part))
const alerts = () => tree.root.findAllByProps({ role: 'alert' }).map(text)
const click = target => act(async () => { target.props.onClick({ stopPropagation() {}, preventDefault() {} }) })
// Macrotask flush that still works while setTimeout is mocked.
const flush = () => act(async () => { await new Promise(resolve => setImmediate(resolve)) })
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const sent = method => requests.filter(r => r.method === method).map(r => r.url)

const badge = { key: 'milestone:10', kind: 'milestone', tier: 'gold', title: '10 trails', description: 'Completed 10 different trails', target_id: null, awarded_at: '2026-10-20T15:00:00Z' }
const profile = (overrides = {}) => ({ handle: 'alex', display_name: 'Alex', joined: '2025-09-01', is_me: false, is_public: true,
  following: false, follows_you: true, followers_count: 3, following_count: 2, completed_trails: 12, total_trails: 40,
  badge_count: 1, badges: [badge], ...overrides })
const privateProfile = { handle: 'sam', display_name: 'Sam', joined: '2024-01-31', is_me: false, is_public: false, following: false,
  follows_you: false, followers_count: 1, following_count: 0, completed_trails: null, total_trails: 40, badge_count: null, badges: [] }
const card = (handle, overrides = {}) => ({ handle, display_name: handle[0].toUpperCase() + handle.slice(1), is_public: true,
  badge_count: 2, followers_count: 1, following: false, is_me: false, ...overrides })
const profileProps = (overrides = {}) => ({ handle: 'alex', onBack: () => opened.push('back'), onEditProfile: () => opened.push('edit'), ...overrides })

// ---------- public profile ----------

test('public profile: name, handle, join date, counts, trails, badges and the profile link', async () => {
  responses['GET /api/users/alex'] = [200, profile()]
  await mount(ui.PublicProfile, profileProps())
  await flush()
  assert.deepEqual(requests.map(r => [r.url, r.auth]), [['/api/users/alex', 'Bearer synthetic-test-token']])
  const body = page()
  assert.match(body, /HIKER PROFILE/)
  assert.match(body, /Alex/)
  assert.match(body, /@alexFollows you/)
  assert.match(body, /Joined September 2025/)
  assert.match(body, /12 of 40/)
  assert.match(body, /trails completed with a check-in/)
  assert.match(body, /1badge earned/)
  assert.match(body, /🥇/)
  assert.match(body, /Completed 10 different trails/)
  assert.ok(button('3 followers'))
  assert.ok(button('2 following'))
  assert.equal(button('Follow').props['aria-pressed'], false)
  assert.equal(button('Edit profile'), undefined)

  await click(button('Copy profile link'))
  assert.deepEqual(copied, [`${ORIGIN}/?u=alex`])
  assert.match(page(), /Link copied/)

  // No clipboard (insecure context, old browser): the link is shown to copy by hand.
  navigator.clipboard = undefined
  await click(button('Copy profile link'))
  assert.equal(tree.root.findByProps({ readOnly: true }).props.value, `${ORIGIN}/?u=alex`)
  assert.match(page(), /Couldn't copy the link/)   // announced, not just shown

  await click(button('← Back'))
  assert.deepEqual(opened, ['back'])
})

test('public profile: lands focus on the name, but never pulls it out of an open dialog', async () => {
  responses['GET /api/users/alex'] = [200, profile()]
  const focused = []
  const createNodeMock = el => (el.type === 'h1' ? { focus: () => focused.push('h1') } : null)
  document.body = { tag: 'body' }
  document.activeElement = document.body   // the search row that opened the profile is gone
  await mount(ui.PublicProfile, profileProps(), { createNodeMock })
  await flush()
  assert.deepEqual(focused, ['h1'])
  await act(async () => tree.unmount()); tree = null

  focused.length = 0
  document.activeElement = { tag: 'input', inDialog: true }   // e.g. the sign-up dialog over a shared ?u= link
  await mount(ui.PublicProfile, profileProps(), { createNodeMock })
  await flush()
  assert.deepEqual(focused, [])
})

test('public profile: followers and following lists, a page at a time; rows open profiles', async () => {
  responses['GET /api/users/alex'] = [200, profile()]
  const first = Array.from({ length: 50 }, (_, i) => card(`hiker${String(i).padStart(2, '0')}`, { followed_at: `2026-10-${String(50 - i).padStart(2, '0')}T12:00:00Z` }))
  first[49].followed_at = '2026-09-01T12:00:00Z'
  responses['GET /api/users/alex/followers?limit=50'] = [200, first]
  // The next page continues from the last row shown (a cursor, so unfollows meanwhile skip nobody).
  responses['GET /api/users/alex/followers?limit=50&before=2026-09-01T12%3A00%3A00Z'] = [200, [card('zed')]]
  responses['GET /api/users/alex/following?limit=50'] = [200, []]
  await mount(ui.PublicProfile, profileProps())
  await flush()
  await click(button('3 followers'))
  await flush()
  const rows = () => tree.root.findByProps({ id: 'profile-followers' }).findAllByType('li')
  assert.equal(button('3 followers').props['aria-expanded'], true)
  assert.equal(rows().length, 50)
  assert.match(text(rows()[0]), /Hiker00@hiker00 · 2 badges · 1 follower/)
  await click(button('Show more'))
  await flush()
  assert.equal(rows().length, 51)
  assert.equal(button('Show more'), undefined)
  await click(buttonWith('@zed'))
  assert.deepEqual(opened, ['zed'])

  await click(button('2 following'))
  await flush()
  assert.match(text(tree.root.findByProps({ id: 'profile-following' })), /Not following anyone yet\./)
})

test('private profile: name, handle, join date and counts only; lists are private', async () => {
  responses['GET /api/users/sam'] = [200, privateProfile]
  responses['GET /api/users/sam/following?limit=50'] = [403, { detail: 'this profile is private' }]
  await mount(ui.PublicProfile, profileProps({ handle: 'sam' }))
  await flush()
  const body = page()
  assert.match(body, /Sam/)
  assert.match(body, /@sam/)
  assert.match(body, /Joined January 2024/)
  assert.match(body, /This profile is private\./)
  assert.doesNotMatch(body, /trails completed|Badges|badge earned|Follows you/)
  assert.ok(button('1 follower'))
  assert.ok(button('Follow'))   // following a private hiker is allowed
  await click(button('0 following'))
  await flush()
  assert.match(page(), /This hiker's lists are private\./)
})

test('profile: loading, unknown username, and a failed load that can be retried', async () => {
  const reply = deferred()
  responses['GET /api/users/nobody'] = () => reply.promise
  await mount(ui.PublicProfile, profileProps({ handle: 'nobody' }))
  assert.match(page(), /Loading profile…/)
  await act(async () => reply.resolve([404, { detail: 'no hiker with that username' }]))
  await flush()
  assert.match(page(), /No hiker with that username\./)
  assert.doesNotMatch(page(), /Loading/)
  await act(async () => tree.unmount()); tree = null

  responses['GET /api/users/alex'] = [500, { detail: 'database down' }]
  await mount(ui.PublicProfile, profileProps())
  await flush()
  assert.match(alerts().join(), /We couldn't load this profile/)
  responses['GET /api/users/alex'] = [200, profile()]
  await click(button('Try again'))
  await flush()
  assert.match(page(), /Joined September 2025/)
})

test('follow: shown at once, the server count wins; a failed unfollow is rolled back', async () => {
  responses['GET /api/users/alex'] = [200, profile()]
  const put = deferred()
  responses['PUT /api/me/following/alex'] = () => put.promise
  responses['GET /api/users/alex/followers?limit=50'] = [200, [card('bea')]]
  await mount(ui.PublicProfile, profileProps())
  await flush()
  await click(button('3 followers'))   // open list reloads after the follow
  await flush()
  await click(button('Follow'))
  assert.equal(button('Following').props['aria-pressed'], true)
  assert.equal(button('Following').props['aria-label'], 'Following Alex')
  assert.ok(button('4 followers'))
  await act(async () => put.resolve([200, { following: true, followers_count: 7 }]))
  await flush()
  assert.ok(button('7 followers'))
  const follow = requests.find(r => r.method === 'PUT')
  assert.equal(follow.url, '/api/me/following/alex')
  assert.equal(follow.auth, 'Bearer synthetic-test-token')
  assert.equal(sent('GET').filter(u => u.includes('/followers')).length, 2)

  responses['DELETE /api/me/following/alex'] = [500, { detail: 'down' }]
  await click(button('Following'))
  await flush()
  assert.ok(button('Following'))
  assert.ok(button('7 followers'))
  assert.match(alerts().join(), /Couldn't unfollow Alex\. Try again\./)
  assert.deepEqual(sent('DELETE'), ['/api/me/following/alex'])
})

test('signed out: the profile loads without a token and Follow asks to log in', async () => {
  responses['GET /api/users/alex'] = [200, profile({ following: null, follows_you: false })]
  await mount(ui.PublicProfile, profileProps(), { auth: signedOut() })
  await flush()
  assert.equal(requests[0].auth, undefined)
  assert.equal(button('Follow'), undefined)
  await click(button('Log in to follow'))
  assert.equal(logins, 1)
  assert.deepEqual(sent('PUT'), [])
  await act(async () => tree.unmount()); tree = null

  // A preview without Auth0 settings explains instead of opening a pop-up.
  await mount(preview.PublicProfile, profileProps(), { auth: signedOut(), lib: preview })
  await flush()
  await click(button('Log in to follow'))
  assert.equal(logins, 1)
  assert.match(alerts().join(), /Sign-in is unavailable in this preview/)
})

test('your own profile: Edit profile instead of Follow, and a note when it is private', async () => {
  responses['GET /api/users/alex'] = [200, profile({ is_me: true, is_public: false, following: null, follows_you: false })]
  await mount(ui.PublicProfile, profileProps())
  await flush()
  assert.match(page(), /YOUR PUBLIC PROFILE/)
  assert.equal(button('Follow'), undefined)
  assert.equal(button('Log in to follow'), undefined)
  assert.match(page(), /Your profile is private: other hikers see only your name, username, join date and follower counts\./)
  assert.match(page(), /Completed 10 different trails/)
  await click(button('Edit profile'))
  assert.deepEqual(opened, ['edit'])
})

test('your own profile: following or unfollowing from your lists updates your following count', async () => {
  responses['GET /api/users/alex'] = [200, profile({ is_me: true, following: null, follows_you: false, following_count: 2 })]
  responses['GET /api/users/alex/following?limit=50'] = [200, [card('bea', { following: true }), card('cy', { following: true })]]
  responses['DELETE /api/me/following/bea'] = [200, { following: false, followers_count: 0 }]
  responses['PUT /api/me/following/bea'] = [200, { following: true, followers_count: 1 }]
  await mount(ui.PublicProfile, profileProps())
  await flush()
  await click(button('2 following'))
  await flush()
  await click(tree.root.findByProps({ 'aria-label': 'Following Bea' }))
  await flush()
  assert.ok(button('1 following'))
  await click(tree.root.findByProps({ 'aria-label': 'Follow Bea' }))
  await flush()
  assert.ok(button('2 following'))
})

test('profile: a link that cannot be a username is not sent to the server', async () => {
  await mount(ui.PublicProfile, profileProps({ handle: 'alex/followers' }))
  await flush()
  assert.deepEqual(requests, [])
  assert.match(page(), /No hiker with that username\./)
})

// ---------- community: people search and following activity ----------

const post = { id: 'r1', author: 'Riley', author_handle: 'riley', trail_id: 't1', trail_name: 'Forest Loop', comment: 'Great views', likes: 0, liked: false,
  created_at: '2026-10-01T12:00:00Z', accuracy: 4, difficulty: 3, enjoyment: 5, tip: false, mine: false }
const FEED = 'GET /api/reviews/feed?sort=recent&limit=20&skip=0'
const ACTIVITY = 'GET /api/me/following/activity?limit=30'
const communityProps = { trails: [], onReview() {}, reloadKey: 0 }
const searchBox = () => tree.root.findByProps({ id: 'find-hikers' })
const type = value => act(async () => searchBox().props.onChange({ target: { value } }))
const tick = ms => act(async () => { mock.timers.tick(ms) })
const searches = () => sent('GET').filter(u => u.startsWith('/api/users?'))

test('community feed: signing in behind a profile refreshes the posts in place, keeping every page shown', async () => {
  const posts = Array.from({ length: 20 }, (_, i) => ({ ...post, id: `r${i}`, comment: `Post ${i}` }))
  responses[FEED] = [200, posts]
  responses['GET /api/reviews/feed?sort=recent&limit=20&skip=20'] = [200, [{ ...post, id: 'r20', comment: 'Post 20' }]]
  await mount(ui.Community, communityProps, { auth: signedOut() })
  await flush()
  await click(button('Show more posts'))
  await flush()
  assert.equal(tree.root.findByProps({ 'aria-label': 'Community posts' }).findAllByType('li').length, 21)

  // Hidden behind a profile, the guest signs in with the pop-up; the signed-in feed is slow to arrive.
  const slow = deferred()
  responses['GET /api/reviews/feed?sort=recent&limit=21&skip=0'] = () => slow.promise
  responses[ACTIVITY] = [200, []]
  await act(async () => tree.update(element(ui.Community, { ...communityProps, active: false }, session(), true)))
  await flush()
  assert.doesNotMatch(page(), /Loading posts/)   // the rows (and the author button that opened the profile) stay
  assert.equal(tree.root.findByProps({ 'aria-label': 'Community posts' }).findAllByType('li').length, 21)
  await act(async () => slow.resolve([200, [...posts, { ...post, id: 'r20', comment: 'Post 20', liked: true }]]))
  await flush()
  const refreshed = requests.find(r => r.url === '/api/reviews/feed?sort=recent&limit=21&skip=0')
  assert.equal(refreshed.auth, 'Bearer synthetic-test-token')
  assert.equal(tree.root.findByProps({ 'aria-label': 'Community posts' }).findAllByType('li').length, 21)
  assert.match(page(), /Post 20/)
  assert.equal(button('Show more posts'), undefined)   // still the end of the feed
})

test('people search: waits for 2+ characters and a pause in typing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  responses[FEED] = [200, [post]]
  responses['GET /api/users?q=ale'] = [200, [card('alex'), card('alexis', { is_public: false, badge_count: 0, followers_count: 2 })]]
  responses['GET /api/users?q=zz'] = [200, []]
  await mount(ui.Community, communityProps, { auth: signedOut() })
  await flush()
  assert.match(page(), /Great views/)   // the feed is unchanged
  assert.doesNotMatch(page(), /From people you follow/)
  assert.deepEqual(sent('GET').filter(u => u.includes('following')), [])

  await type('a')
  await tick(1000); await flush()
  assert.deepEqual(searches(), [])
  assert.match(page(), /Type at least 2 characters\./)

  await type('al'); await tick(200)
  await type('ale'); await tick(299); await flush()
  assert.deepEqual(searches(), [])
  await tick(1); await flush()
  assert.deepEqual(searches(), ['/api/users?q=ale'])
  assert.equal(requests.find(r => r.url === '/api/users?q=ale').auth, undefined)
  const found = tree.root.findByProps({ 'aria-label': 'Hikers found' }).findAllByType('li').map(text)
  assert.deepEqual(found, ['AAlex@alex · 2 badges · 1 follower', 'AAlexis@alexis · Private profile · 2 followers'])
  assert.equal(buttons().filter(b => /^Follow/.test(text(b))).length, 0)   // signed out: no follow buttons

  await type(' @zz '); await tick(300); await flush()
  assert.deepEqual(searches(), ['/api/users?q=ale', '/api/users?q=zz'])
  assert.match(page(), /No hikers match\./)
})

test('people search: follow from the results; rows open profiles; never yourself', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  responses[FEED] = [200, []]
  responses[ACTIVITY] = [200, []]
  responses['GET /api/users?q=al'] = [200, [card('alex'), card('alma', { display_name: 'Alma (me)', is_me: true })]]
  responses['PUT /api/me/following/alex'] = [200, { following: true, followers_count: 2 }]
  await mount(ui.Community, communityProps)
  await flush()
  await type('al'); await tick(300); await flush()
  assert.equal(requests.find(r => r.url === '/api/users?q=al').auth, 'Bearer synthetic-test-token')
  const follows = buttons().filter(b => /^Follow/.test(text(b)))
  assert.deepEqual(follows.map(b => b.props['aria-label']), ['Follow Alex'])
  assert.match(page(), /Alma \(me\) \(you\)/)
  await click(follows[0])
  await flush()
  assert.deepEqual(sent('PUT'), ['/api/me/following/alex'])
  assert.equal(button('Following').props['aria-pressed'], true)
  assert.match(page(), /@alex · 2 badges · 2 followers/)
  assert.equal(sent('GET').filter(u => u === ACTIVITY.slice(4)).length, 2)   // activity refreshed after the follow
  await click(buttonWith('@alex'))
  assert.deepEqual(opened, ['alex'])
})

test('following activity: who earned which badge, names open profiles; empty state', async () => {
  responses[FEED] = [200, []]
  responses[ACTIVITY] = [200, [{ user: { handle: 'jordan', display_name: 'Jordan' }, badge }]]
  await mount(ui.Community, communityProps)
  await flush()
  const activity = tree.root.findByProps({ 'aria-label': 'Badges earned by people you follow' })
  assert.match(text(activity), /Jordan earned 🥇 10 trails/)
  assert.equal(requests.find(r => r.url === ACTIVITY.slice(4)).auth, 'Bearer synthetic-test-token')
  await click(button('Jordan'))
  assert.deepEqual(opened, ['jordan'])
  await act(async () => tree.unmount()); tree = null

  responses[ACTIVITY] = [200, []]
  await mount(ui.Community, communityProps)
  await flush()
  assert.match(page(), /From people you follow/)
  assert.match(page(), /Follow hikers to see the badges they earn here\./)
})

test('people search: spaces after @ do not count toward the 2 characters', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  responses[FEED] = [200, []]
  await mount(ui.Community, communityProps, { auth: signedOut() })
  await flush()
  await type('@ j'); await tick(300); await flush()
  assert.deepEqual(searches(), [])
  assert.match(page(), /Type at least 2 characters\./)
})

test('people search: back from a profile, rows take the fresh results even when they match the first ones', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  responses[FEED] = [200, []]
  responses[ACTIVITY] = [200, []]
  responses['GET /api/users?q=bo'] = () => [200, [card('bob')]]   // parsed afresh each time, like fetch
  responses['PUT /api/me/following/bob'] = [200, { following: true, followers_count: 2 }]
  const auth = session()
  await mount(ui.Community, communityProps, { auth })
  await flush()
  await type('bo'); await tick(300); await flush()
  await click(button('Follow'))
  await flush()
  assert.match(page(), /@bob · 2 badges · 2 followers/)
  // Hidden behind Bob's profile (where he is unfollowed), then shown again: the search runs again.
  await act(async () => tree.update(element(ui.Community, { ...communityProps, active: false }, auth, true)))
  await act(async () => tree.update(element(ui.Community, { ...communityProps, active: true }, auth, true)))
  await tick(300); await flush()
  assert.equal(searches().length, 2)
  assert.ok(button('Follow'))
  assert.match(page(), /@bob · 2 badges · 1 follower/)
})

// ---------- comment authors ----------

test('comment author: a link to their profile when they have a handle, plain text otherwise', async () => {
  await mount(ui.CommentItem, { c: post, showTrail: true })
  let stopped = false
  await act(async () => button('Riley').props.onClick({ stopPropagation() { stopped = true } }))
  assert.deepEqual(opened, ['riley'])
  assert.ok(stopped)   // a trail card behind it is not selected
  await act(async () => tree.unmount()); tree = null

  const tip = { id: 'tip1', author: 'HikingPSU', author_handle: null, tip: true, comment: 'Bring water', likes: 0, liked: false }
  await mount(ui.CommentItem, { c: tip })
  assert.match(page(), /HikingPSU/)
  assert.equal(button('HikingPSU'), undefined)
  await act(async () => tree.unmount()); tree = null

  await mount(ui.CommentItem, { c: post }, { withLinks: false })
  assert.match(page(), /Riley/)
  assert.equal(button('Riley'), undefined)
})

// ---------- your profile: username and public profile switch ----------

const me = { handle: 'alex', profile: { age: null, home_area: null, fitness: null, group_type: null, public_profile: null },
  preferences: { transit_modes: [], max_drive_min: null, max_time_min: null, preferred_features: [], avoid: [], max_level: null, prefers_loop: null, preferred_seasons: [] } }
const insights = { stats: { total_hikes: 0, unique_trails: 0, total_distance_mi: 0, total_elevation_gain_ft: 0 }, profile_completeness: 10, level_counts: {}, feature_affinity: {},
  felt_vs_official: null, comfortable_level: null, avg_rating: null, season_counts: {}, top_areas: [] }
function dashboardResponses(user = me) {
  responses['GET /api/me'] = [200, user]
  responses['GET /api/me/insights'] = [200, insights]
  responses['GET /api/me/hikes?limit=200'] = [200, []]
  responses['GET /api/me/badges'] = [200, { badges: [], completed_trails: 0, total_trails: 40, milestones: [], parks: [], repeats: [], today_remaining: 2 }]
}
const handleInput = () => tree.root.findByProps({ 'aria-describedby': 'handle-hint' })
const handleForm = () => tree.root.findAllByType('form').find(f => f.findAllByProps({ 'aria-describedby': 'handle-hint' }).length)
const setInput = value => act(async () => handleInput().props.onChange({ target: { value } }))
const submitHandle = async () => { await act(async () => handleForm().props.onSubmit({ preventDefault() {} })); await flush() }
const checkbox = () => tree.root.findByProps({ type: 'checkbox' })

test('profile: change your username; the rule is checked first, then the server', async () => {
  dashboardResponses()
  await mount(ui.Dashboard, { trails: [], onViewPublicProfile: handle => opened.push(['view', handle]), onHandleChange: handle => opened.push(['handle', handle]) })
  await flush()
  assert.match(page(), /Your username is @alex/)
  assert.equal(handleInput().props.value, 'alex')
  assert.equal(button('Save').props.disabled, true)   // unchanged

  await setInput('1abc')
  await submitHandle()
  assert.match(alerts().join(), /Start your username with a letter\./)
  await setInput('ab')
  await submitHandle()
  assert.match(alerts().join(), /3–20 characters/)
  assert.deepEqual(sent('PUT'), [])

  responses['PUT /api/me/handle'] = [409, { detail: 'That username is taken.' }]
  await setInput(' @Taken_Name ')
  await submitHandle()
  assert.deepEqual(requests.filter(r => r.method === 'PUT').map(r => [r.url, r.body, r.auth]), [['/api/me/handle', { handle: 'taken_name' }, 'Bearer synthetic-test-token']])
  assert.deepEqual(alerts(), ['That username is taken.'])
  assert.match(page(), /Your username is @alex/)

  responses['PUT /api/me/handle'] = [422, { detail: [{ msg: 'That username is reserved.' }] }]
  await setInput('admin')
  await submitHandle()
  assert.deepEqual(alerts(), ['That username is reserved.'])

  responses['PUT /api/me/handle'] = [200, { ...me, handle: 'trail_fan' }]
  await setInput('trail_fan')
  await submitHandle()
  assert.deepEqual(alerts(), [])
  assert.match(page(), /Your username is @trail_fan/)
  assert.match(page(), /Username saved\./)
  assert.deepEqual(opened, [['handle', 'trail_fan']])   // App refreshes comments that link to the old username
  await click(button('View my public profile'))
  assert.deepEqual(opened, [['handle', 'trail_fan'], ['view', 'trail_fan']])
  await click(button('Copy profile link'))
  assert.deepEqual(copied, [`${ORIGIN}/?u=trail_fan`])
})

test('profile: the public profile switch saves profile.public_profile through PATCH /me', async () => {
  dashboardResponses()
  await mount(ui.Dashboard, { trails: [] })
  await flush()
  assert.equal(checkbox().props.checked, true)   // null means public
  const patch = deferred()
  responses['PATCH /api/me'] = () => patch.promise
  await act(async () => { checkbox().props.onChange({ target: { checked: false } }) })
  assert.equal(checkbox().props.checked, false)   // shown at once while saving
  await act(async () => patch.resolve([200, { ...me, profile: { ...me.profile, public_profile: false } }]))
  await flush()
  assert.deepEqual(requests.filter(r => r.method === 'PATCH').map(r => r.body), [{ profile: { public_profile: false } }])
  assert.equal(checkbox().props.checked, false)
  assert.equal(button('View my public profile'), undefined)   // no onViewPublicProfile here
  assert.match(page(), /Show my badges and stats on my public profile/)
})
