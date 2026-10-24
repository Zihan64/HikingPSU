import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocationController, formatAccuracy } from '../src/location.js'

const fix = { coords: { latitude: 40.7934, longitude: -77.86, accuracy: 24 }, timestamp: 1700000000000 }

function setup(overrides = {}) {
  const watches = []
  const cleared = []
  const geolocation = {
    watchPosition(success, error, options) {
      watches.push({ success, error, options })
      return watches.length - 1
    },
    clearWatch(id) { cleared.push(id) },
  }
  return { controller: createLocationController({ geolocation, secureContext: true, ...overrides }), watches, cleared }
}

test('does not access location before an explicit request; one successful fix stops watching', () => {
  const { controller, watches, cleared } = setup()
  const disconnect = controller.connect()
  assert.equal(watches.length, 0)
  controller.request()
  controller.request() // duplicate clicks must not create another watcher
  assert.equal(watches.length, 1)
  assert.equal(watches[0].options.enableHighAccuracy, true)
  assert.equal(watches[0].options.maximumAge, 0)
  assert.equal(controller.getSnapshot().status, 'locating')
  watches[0].success(fix)
  assert.equal(controller.getSnapshot().status, 'ready')
  assert.equal(controller.getSnapshot().position.latitude, fix.coords.latitude)
  assert.equal(controller.getSnapshot().position.accuracy, 24)
  assert.deepEqual(cleared, [0]) // zero is a valid watch id
  watches[0].success({ ...fix, coords: { ...fix.coords, latitude: 41 } })
  assert.equal(controller.getSnapshot().position.latitude, fix.coords.latitude)
  controller.clear()
  assert.equal(controller.getSnapshot().position, null)
  disconnect()
})

for (const code of [2, 3]) {
  test(`high-accuracy error ${code} retries once at standard accuracy and then reports failure`, () => {
    const { controller, watches, cleared } = setup()
    controller.request()
    watches[0].error({ code })
    assert.equal(controller.getSnapshot().status, 'fallback')
    assert.equal(watches.length, 2)
    assert.equal(watches[1].options.enableHighAccuracy, false)
    assert.deepEqual(cleared, [0])
    watches[1].error({ code })
    assert.equal(controller.getSnapshot().status, 'error')
    assert.equal(controller.getSnapshot().position, null)
    assert.deepEqual(cleared, [0, 1])
    assert.equal(watches.length, 2)
    assert.match(controller.getSnapshot().error, code === 3 ? /timed out/ : /unavailable/)
  })
}

test('standard-accuracy fallback can produce a usable approximate fix', () => {
  const { controller, watches } = setup()
  controller.request()
  watches[0].error({ code: 3 })
  watches[1].success({ ...fix, coords: { ...fix.coords, accuracy: 2500 } })
  assert.equal(controller.getSnapshot().status, 'ready')
  assert.equal(controller.getSnapshot().position.accuracy, 2500)
})

test('denial stops immediately without fallback or repeated prompts', () => {
  const { controller, watches, cleared } = setup()
  controller.request()
  watches[0].error({ code: 1 })
  assert.equal(controller.getSnapshot().status, 'denied')
  assert.deepEqual(cleared, [0])
  controller.request()
  assert.equal(watches.length, 1)
  assert.match(controller.getSnapshot().error, /browser settings/)
})

test('cancel ignores late callbacks and a subsequent request can still succeed', () => {
  const { controller, watches, cleared } = setup()
  controller.request()
  controller.cancel()
  assert.deepEqual(cleared, [0])
  watches[0].success(fix)
  watches[0].error({ code: 3 })
  assert.equal(watches.length, 1)
  assert.equal(controller.getSnapshot().status, 'idle')
  controller.request()
  watches[0].error({ code: 1 })
  assert.equal(controller.getSnapshot().status, 'locating')
  watches[1].success(fix)
  assert.equal(controller.getSnapshot().status, 'ready')
})

test('disconnect stops pending location and ignores late results', () => {
  const { controller, watches, cleared } = setup()
  const disconnect = controller.connect()
  controller.request()
  disconnect()
  watches[0].success(fix)
  assert.deepEqual(cleared, [0])
  assert.equal(controller.getSnapshot().position, null)
  const stopAgain = controller.connect()
  controller.request()
  assert.equal(watches.length, 2)
  stopAgain()
})

for (const overrides of [{ secureContext: false }, { geolocation: undefined }, { policyAllowed: false }]) {
  test(`unsupported environment does not request location: ${JSON.stringify(overrides)}`, () => {
    const { controller, watches } = setup(overrides)
    controller.request()
    assert.equal(controller.getSnapshot().status, 'unavailable')
    assert.ok(controller.getSnapshot().error)
    assert.equal(watches.length, 0)
  })
}

test('invalid coordinates are never exposed as a successful location', () => {
  const { controller, watches } = setup()
  controller.request()
  watches[0].success({ coords: { latitude: NaN, longitude: -77, accuracy: 20 } })
  assert.equal(controller.getSnapshot().status, 'fallback')
  watches[1].success({ coords: { latitude: 91, longitude: 20, accuracy: -1 } })
  assert.equal(controller.getSnapshot().status, 'error')
  assert.equal(controller.getSnapshot().position, null)
})

test('permission query alone never prompts; revocation clears the fix and listeners detach', async () => {
  let listener
  let removed = false
  const permission = {
    state: 'prompt',
    addEventListener(name, fn) { listener = fn },
    removeEventListener(name, fn) { removed = fn === listener },
  }
  const { controller, watches } = setup({ permissions: { query: async () => permission } })
  const disconnect = controller.connect()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(watches.length, 0)
  assert.equal(controller.getSnapshot().permission, 'prompt')
  controller.request()
  watches[0].success(fix)
  permission.state = 'denied'
  listener()
  assert.equal(controller.getSnapshot().position, null)
  assert.equal(controller.getSnapshot().status, 'denied')
  permission.state = 'prompt'
  listener()
  controller.request()
  assert.equal(watches.length, 2)
  disconnect()
  assert.ok(removed)
})

test('browsers that reject Permissions API queries still support location', async () => {
  const { controller, watches } = setup({ permissions: { query: async () => { throw new Error('unsupported') } } })
  const disconnect = controller.connect()
  await new Promise(resolve => setImmediate(resolve))
  controller.request()
  watches[0].success(fix)
  assert.equal(controller.getSnapshot().status, 'ready')
  disconnect()
})

test('an OS-level denial can be retried when browser permission is still granted', async () => {
  const { controller, watches } = setup({ permissions: { query: async () => ({ state: 'granted' }) } })
  const disconnect = controller.connect()
  await new Promise(resolve => setImmediate(resolve))
  controller.request()
  watches[0].error({ code: 1 })
  assert.equal(controller.getSnapshot().status, 'denied')
  controller.request()
  assert.equal(watches.length, 2)
  watches[1].success(fix)
  assert.equal(controller.getSnapshot().status, 'ready')
  disconnect()
})

test('synchronous webview callbacks still clear the returned watch id', () => {
  const cleared = []
  const { controller } = setup({ geolocation: {
    watchPosition(success) { success(fix); return 42 },
    clearWatch(id) { cleared.push(id) },
  } })
  controller.request()
  assert.equal(controller.getSnapshot().status, 'ready')
  assert.deepEqual(cleared, [42])
})

test('accuracy labels retain the difference between metres and kilometres', () => {
  assert.equal(formatAccuracy(0), '1 m')
  assert.equal(formatAccuracy(24), '24 m')
  assert.equal(formatAccuracy(2500), '2.5 km')
})
