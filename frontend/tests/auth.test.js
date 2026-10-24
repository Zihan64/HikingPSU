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
const views = {}
let tree, calls, requests, fetchBefore, windowBefore

before(async () => {
  const cache = new URL('../node_modules/.cache/auth-ui-tests/', import.meta.url)
  await mkdir(fileURLToPath(cache), {recursive:true})
  for (const configured of [true, false]) {
    const outfile = new URL(`${configured ? 'configured' : 'unconfigured'}.mjs`, cache)
    await build({
      entryPoints:[fileURLToPath(new URL('../src/AppHeader.jsx', import.meta.url))],
      outfile:fileURLToPath(outfile), bundle:true, platform:'node', format:'esm', jsx:'automatic',
      external:['react', 'react/jsx-runtime', '@auth0/auth0-react'],
      loader:{'.png':'dataurl', '.css':'empty'},
      define:{'import.meta.env':JSON.stringify(configured ? {
        VITE_AUTH0_DOMAIN:'test.auth0.invalid', VITE_AUTH0_CLIENT_ID:'synthetic-client', VITE_AUTH0_AUDIENCE:'https://api.test.invalid',
      } : {})},
    })
    views[configured] = (await import(outfile.href)).default
  }
})

beforeEach(() => {
  calls = {login:0, profile:0, logout:[]}; requests = []
  fetchBefore = globalThis.fetch; windowBefore = globalThis.window
  globalThis.window = {location:{origin:'http://localhost:5173'}}
  globalThis.fetch = async (url, options) => {
    requests.push({url, options})
    return {ok:true, status:200, json:async () => ({})}
  }
})

afterEach(async () => {
  if (tree) await act(async () => tree.unmount())
  tree = null; globalThis.fetch = fetchBefore; globalThis.window = windowBefore
})

function session(overrides = {}) {
  return {...initialContext, isAuthenticated:false, isLoading:false,
    loginWithPopup:async () => { calls.login++ },
    logout:options => { calls.logout.push(options) },
    getAccessTokenSilently:async () => 'synthetic-test-token', ...overrides}
}

function header(value, configured = true) {
  return React.createElement(Auth0Context.Provider, {value}, React.createElement(views[configured], {
    onHome:() => {}, onLibrary:() => {}, onProfile:() => { calls.profile++ },
  }))
}
async function mount(value, configured = true) { await act(async () => { tree = create(header(value, configured)) }) }
const button = text => tree.root.findAllByType('button').find(b => b.children.includes(text))
const name = () => tree.root.findByProps({className:'account-name'}).children.join('')

test('a signed-out guest has an active Log in button wired to Auth0 pop-up', async () => {
  await mount(session())
  assert.equal(name(), 'Guest')
  assert.equal(button('Log in').props.disabled, false)
  await act(async () => button('Log in').props.onClick())
  assert.equal(calls.login, 1)
  assert.equal(requests.length, 0)
})

test('Auth0 sign-in replaces Guest with the real name/avatar and enables Profile', async () => {
  await mount(session())
  await act(async () => tree.update(header(session({isAuthenticated:true, user:{name:'Alex Test', picture:'https://example.invalid/avatar.png'}}))))
  assert.equal(name(), 'Alex Test')
  assert.equal(tree.root.findByProps({className:'account-avatar'}).props.src, 'https://example.invalid/avatar.png')
  const profile = tree.root.findByProps({className:'account-identity'})
  assert.equal(profile.props.disabled, false)
  await act(async () => profile.props.onClick())
  assert.equal(calls.profile, 1)
  assert.equal(button('Log out').props.disabled, false)
  assert.equal(requests[0].url, '/api/me')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-test-token')
})

test('Log out keeps the existing Auth0 logout callback and return origin', async () => {
  await mount(session({isAuthenticated:true, user:{name:'Alex Test'}}))
  await act(async () => button('Log out').props.onClick())
  assert.deepEqual(calls.logout, [{logoutParams:{returnTo:'http://localhost:5173'}}])
})

test('loading only disables login temporarily; resolving Auth0 makes it active', async () => {
  await mount(session({isLoading:true}))
  assert.equal(name(), 'Loading…')
  assert.equal(button('Log in').props.disabled, true)
  await act(async () => tree.update(header(session())))
  assert.equal(name(), 'Guest')
  assert.equal(button('Log in').props.disabled, false)
})

test('missing configuration explains login availability instead of silently disabling it', async () => {
  await mount(session({isLoading:true}), false)
  assert.equal(button('Log in').props.disabled, false)
  await act(async () => button('Log in').props.onClick())
  assert.match(tree.root.findByProps({role:'alert'}).children.join(''), /Sign-in is unavailable/)
  assert.equal(calls.login, 0)
})

test('an authenticated provider is never replaced by a hard-coded Guest fallback', async () => {
  await mount(session({isAuthenticated:true, user:{name:'Existing signed-in user'}}), false)
  assert.equal(name(), 'Existing signed-in user')
  assert.equal(tree.root.findByProps({className:'account-identity'}).props.disabled, false)
  assert.equal(button('Log out').props.disabled, false)
})

test('profile API failure does not erase the signed-in user or disable Profile', async () => {
  globalThis.fetch = async () => ({ok:false, status:503, json:async () => ({detail:'unavailable'})})
  await mount(session({isAuthenticated:true, user:{name:'Alex Test'}}))
  assert.equal(name(), 'Alex Test')
  assert.equal(tree.root.findByProps({className:'account-identity'}).props.disabled, false)
  assert.equal(button('Log out').props.disabled, false)
})
