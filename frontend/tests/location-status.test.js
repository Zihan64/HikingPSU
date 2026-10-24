import test, { before, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { build } from 'esbuild'

let LocationControl, LocationStatus, tree
const idle = {status:'idle', position:null, tracking:false, error:null}
const controls = location => ({location, onRequest:() => {}, onClear:() => {}, onShowTrails:() => {}})

before(async () => {
  const output = new URL('../node_modules/.cache/location-status-tests/component.mjs', import.meta.url)
  await mkdir(fileURLToPath(new URL('./', output)), {recursive:true})
  await build({entryPoints:[fileURLToPath(new URL('../src/LocationControl.jsx', import.meta.url))],
    outfile:fileURLToPath(output), bundle:true, platform:'node', format:'esm', jsx:'automatic',
    external:['react', 'react/jsx-runtime']})
  const component = await import(output.href)
  LocationControl = component.default; LocationStatus = component.LocationStatus
})
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null })
const mount = element => act(() => { tree = create(element) })
const statuses = () => tree.root.findAllByProps({role:'status'})

test('LocationStatus remains a public named export and can render separately without duplicate status', () => {
  assert.equal(typeof LocationStatus, 'function')
  mount(React.createElement(React.Fragment, null,
    React.createElement(LocationControl, {...controls(idle), showStatus:false}),
    React.createElement(LocationStatus, {location:idle, className:'map-location-status'})))
  assert.equal(statuses().length, 1)
  assert.ok(statuses()[0].props.className.includes('map-location-status'))
  assert.equal(tree.root.findByProps({'aria-label':'Device location'}).findAllByProps({role:'status'}).length, 0)
})

test('existing LocationControl callers still receive the main branch default idle status', () => {
  mount(React.createElement(LocationControl, controls(idle)))
  assert.equal(statuses().length, 1)
  assert.match(statuses()[0].children.join(''), /Optional.*permission is required/)
})

test('sidebar can hide only idle copy and still announce a pending location request', () => {
  mount(React.createElement(LocationStatus, {location:idle, showIdle:false}))
  assert.equal(tree.toJSON(), null)
  act(() => tree.update(React.createElement(LocationStatus, {location:{...idle,status:'locating'}, showIdle:false})))
  assert.match(statuses()[0].children.join(''), /Allow location/)
  assert.equal(statuses()[0].props['aria-live'], 'polite')
})

test('accuracy and permission errors remain visible in the separately rendered status', () => {
  mount(React.createElement(LocationStatus, {location:{...idle,status:'ready',position:{accuracy:42}},routeActive:true,showIdle:false}))
  assert.match(statuses()[0].children.join(''), /±42 m/)
  act(() => tree.update(React.createElement(LocationStatus, {location:{...idle,status:'denied',error:'Location access is blocked.'},showIdle:false})))
  assert.match(statuses()[0].children.join(''), /Location access is blocked/)
  assert.ok(statuses()[0].props.className.includes('location-error'))
})
