import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceToTrail, sortTrails } from '../src/trailSort.js'

const trail = (id, lat, lon) => ({id, trailhead:{lat, lon}})
const origin = {latitude:0, longitude:0}

test('nearest uses geographic distance to trailheads, not trail length or recommendation order', () => {
  const trails = [trail('far', 0, 2), trail('near', 0, 0.1), trail('middle', 1, 0)]
  assert.deepEqual(sortTrails(trails, 'nearest', origin).map(t => t.id), ['near', 'middle', 'far'])
  assert.deepEqual(trails.map(t => t.id), ['far', 'near', 'middle'])
  assert.equal(sortTrails(trails, 'recommended', origin), trails)
  assert.equal(sortTrails(trails, 'nearest', null), trails)
})

test('distances handle coincident points, the date line, and invalid coordinates', () => {
  assert.equal(distanceToTrail(trail('same', 0, 0), origin), 0)
  const acrossDateLine = distanceToTrail(trail('across', 0, -179.9), {latitude:0, longitude:179.9})
  assert.ok(acrossDateLine > 22000 && acrossDateLine < 23000)
  assert.equal(distanceToTrail(trail('missing', null, 0), origin), null)
  assert.equal(distanceToTrail(trail('invalid', 91, 0), origin), null)
  assert.equal(distanceToTrail(trail('valid', 0, 0), {latitude:NaN, longitude:0}), null)
})

test('missing trailheads sort last; equal distances preserve the existing recommendation order', () => {
  const trails = [{id:'unknown'}, trail('first', 0, 1), trail('second', 0, -1)]
  assert.deepEqual(sortTrails(trails, 'nearest', origin).map(t => t.id), ['first', 'second', 'unknown'])
  assert.equal(sortTrails(trails, 'nearest', {latitude:91, longitude:0}).length, 3)
})
