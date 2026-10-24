import test from 'node:test'
import assert from 'node:assert/strict'
import {filterCatalog, formatTime, routeType} from '../src/catalogFilter.js'

const trails = [
  {id:'b', name:'Ridge', park_id:'forest', park_name:'Rothrock', area:'Boalsburg', features:['sunset'], difficulty:{level:3}, distance_mi:2},
  {id:'a', name:'Boardwalk', park_id:'park', park_name:'Lake Park', area:'State College', features:['birds'], difficulty:{level:1}, distance_mi:1},
  {id:'c', name:'Forest Loop', park_id:'forest', park_name:'Rothrock', area:'Boalsburg', features:['birds'], difficulty:{level:1}, distance_mi:3},
]
test('park selection intersects case-insensitive search across town, features and park name', () => {
  assert.deepEqual(filterCatalog(trails, {parkId:'forest', query:'ROTHROCK birds'}).map(t => t.id), ['c'])
  assert.deepEqual(filterCatalog(trails, {query:'STATE COLLEGE'}).map(t => t.id), ['a'])
  assert.equal(filterCatalog(trails, {parkId:'park', query:'sunset'}).length, 0)
  assert.equal(filterCatalog(trails, {query:'   '}).length, trails.length)
})
test('name, difficulty and trail length sort independently without mutating source records', () => {
  assert.deepEqual(filterCatalog(trails).map(t => t.id), ['a','c','b'])
  assert.deepEqual(filterCatalog(trails, {sort:'difficulty'}).map(t => t.id), ['a','c','b'])
  assert.deepEqual(filterCatalog(trails, {sort:'distance'}).map(t => t.id), ['a','b','c'])
  assert.deepEqual(trails.map(t => t.id), ['b','a','c'])
})
test('empty matches and missing park metadata remain usable', () => {
  assert.deepEqual(filterCatalog(trails, {query:'nonexistent'}), [])
  assert.equal(filterCatalog([{...trails[0],park_id:undefined}], {parkId:'other-nearby-trails'}).length, 1)
})
test('time and route labels preserve backend values and OSM one-way semantics', () => {
  assert.equal(formatTime(85), '1 h 25 min')
  assert.equal(formatTime(60), '1 h')
  assert.equal(formatTime(0), '0 min')
  assert.equal(routeType({loop:true}), 'Loop')
  assert.equal(routeType({loop:false, notes:'OSM (one-way length; an out-and-back is roughly double)'}), 'One-way · out-and-back ≈ 2×')
  assert.equal(routeType({loop:false, notes:''}), 'Out-and-back')
})
