import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareRouteReference, locateOnRoute, distanceMeters } from '../src/trailGeometry.js'

// Synthetic geometry, not a published or suggested trail.
const a = [-77, 40], b = [-76.999, 40], c = [-76.998, 40], d = [-76.999, 40.001]
const feature = (name, coords, type = 'LineString') => ({type:'Feature', properties:{Name:name}, geometry:{type, coordinates:coords}})
const collection = (...features) => ({type:'FeatureCollection', features})
const now = 1800000000000
const fix = (longitude, latitude = 40, accuracy = 10, timestamp = now) => ({longitude, latitude, accuracy, timestamp})
const openRoute = () => prepareRouteReference(collection(feature('West', [a, b]), feature('East', [c, b])))

test('orders only source-connected segments and preserves their actual coordinates', () => {
  const ref = openRoute()
  assert.equal(ref.connected, true)
  assert.equal(ref.loop, false)
  assert.deepEqual(ref.coordinates, [a, b, c])
  assert.deepEqual(ref.steps.map(s => s.name), ['West', 'East'])
  assert.ok(Math.abs(ref.lengthMeters - distanceMeters(a, c)) < 0.01)
  assert.equal(ref.steps[0].endMeters, ref.steps[1].startMeters)
})

test('reversing the reference reverses actual source geometry without inventing a turn', () => {
  const ref = prepareRouteReference(collection(feature('West', [a, b]), feature('East', [c, b])), true)
  assert.deepEqual(ref.coordinates, [c, b, a])
  assert.deepEqual(ref.steps.map(s => s.name), ['East', 'West'])
  assert.ok(ref.steps.every(s => !('instruction' in s)))
})

test('a closed loop has reference distances but never reports arrival at its start', () => {
  const ref = prepareRouteReference(collection(feature('Loop', [a, b, d, a])))
  assert.equal(ref.loop, true)
  const match = locateOnRoute(ref, fix(...a), now)
  assert.equal(match.status, 'near_route')
  assert.equal(match.alongMeters, 0)
  assert.ok(match.remainingMeters > 0)
  assert.equal('arrived' in match, false)
})

test('disconnected parts and branched trails remain separate overlay lines', () => {
  for (const data of [collection(feature('West', [a, b]), feature('Gap', [c, d])),
    collection(feature('West', [a, b]), feature('East', [b, c]), feature('Branch', [b, d]))]) {
    const ref = prepareRouteReference(data)
    assert.equal(ref.connected, false)
    assert.deepEqual(ref.coordinates, [])
    assert.deepEqual(ref.steps, [])
    const match = locateOnRoute(ref, fix(...a), now)
    assert.equal(match.status, 'near_route')
    assert.equal(match.alongMeters, null)
    assert.equal(match.remainingMeters, null)
  }
})

test('two disconnected closed loops are not treated as one connected route', () => {
  const ref = prepareRouteReference(collection(feature('Loops', [[a, b, a], [c, d, c]], 'MultiLineString')))
  assert.equal(ref.connected, false)
  assert.equal(ref.lines.length, 2)
})

test('invalid source geometry cannot enter route matching', () => {
  for (const coords of [[], [a], [a, [NaN, 40]], [a, [-181, 40]], [a, [-77, 91]]]) {
    assert.throws(() => prepareRouteReference(collection(feature('Invalid', coords))))
  }
  assert.throws(() => prepareRouteReference(collection(feature('Point', a, 'Point'))))
})

test('projects a fresh accurate position and chooses the corresponding source segment', () => {
  const ref = openRoute(), match = locateOnRoute(ref, fix(-76.9985), now)
  assert.equal(match.status, 'near_route')
  assert.equal(match.stepIndex, 1)
  assert.ok(Math.abs(match.alongMeters / ref.lengthMeters - .75) < .001)
  assert.ok(Math.abs(match.remainingMeters / ref.lengthMeters - .25) < .001)
})

test('stale, invalid and low accuracy fixes suppress progress', () => {
  const ref = openRoute()
  assert.equal(locateOnRoute(ref, null, now).status, 'no_position')
  for (const position of [fix(-77, 40, 10, now - 46000), fix(-77, 40, 10, now + 11000), fix(-77, 40, 10, NaN)]) {
    const match = locateOnRoute(ref, position, now)
    assert.equal(match.status, 'stale')
    assert.equal(match.alongMeters, undefined)
  }
  for (const position of [fix(-77, 40, 200), fix(-77, 91), fix(-181), fix(-77, 40, -1)]) {
    const match = locateOnRoute(ref, position, now)
    assert.equal(match.status, 'poor_accuracy')
    assert.equal(match.alongMeters, undefined)
  }
})

test('uncertain and off-route positions never generate progress or a shortcut', () => {
  const ref = openRoute()
  for (const [lat, status] of [[40.00025, 'uncertain'], [40.002, 'off_route']]) {
    const match = locateOnRoute(ref, fix(-76.9995, lat), now)
    assert.equal(match.status, status)
    assert.equal(match.alongMeters, undefined)
    assert.equal('connector' in match, false)
  }
})
