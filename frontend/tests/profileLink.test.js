import test from 'node:test'
import assert from 'node:assert/strict'
import { HANDLE_PATTERN, formatJoined, handleProblem, normalizeHandle, profileUrl, readProfileParam } from '../src/profileLink.js'

test('?u= links: the handle is read and removed, the rest of the query is kept', () => {
  assert.deepEqual(readProfileParam('?u=alex'), { handle: 'alex', search: '' })
  assert.deepEqual(readProfileParam('?x=1&u=Alex_K&y=2'), { handle: 'alex_k', search: '?x=1&y=2' })
  assert.deepEqual(readProfileParam('?u=%40Trail_Fan%20'), { handle: 'trail_fan', search: '' })
  assert.deepEqual(readProfileParam('?u=&x=1'), { handle: null, search: '?x=1' })
  assert.deepEqual(readProfileParam('?x=1'), { handle: null, search: '?x=1' })
  assert.deepEqual(readProfileParam(''), { handle: null, search: '' })
  assert.deepEqual(readProfileParam(), { handle: null, search: '' })
})

test('profile links have the form <origin>/?u=<handle> and round-trip', () => {
  const url = profileUrl('alex_k', 'https://hikingpsu.test')
  assert.equal(url, 'https://hikingpsu.test/?u=alex_k')
  assert.equal(readProfileParam(new URL(url).search).handle, 'alex_k')
})

test('handle rule: 3-20 characters, lowercase letters, digits and _, starting with a letter', () => {
  for (const ok of ['abc', 'alex_k1', 'a'.repeat(20), 'trail_fan_2026']) {
    assert.ok(HANDLE_PATTERN.test(ok), ok)
    assert.equal(handleProblem(ok), null, ok)
  }
  assert.match(handleProblem('ab'), /3–20 characters/)
  assert.match(handleProblem('a'.repeat(21)), /3–20 characters/)
  assert.match(handleProblem('1abc'), /Start your username with a letter/)
  assert.match(handleProblem('_abc'), /Start your username with a letter/)
  assert.match(handleProblem('al-ex'), /only lowercase letters, numbers and underscores/)
  assert.match(handleProblem('al ex'), /only lowercase letters, numbers and underscores/)
  assert.equal(HANDLE_PATTERN.test('Alex'), false)
  assert.equal(normalizeHandle('  @Alex_K '), 'alex_k')
  assert.equal(normalizeHandle(null), '')
})

test('join dates are calendar dates: no timezone moves them to the previous month', () => {
  const tz = process.env.TZ
  process.env.TZ = 'America/Los_Angeles'
  try {
    assert.equal(formatJoined('2025-09-01'), 'September 2025')
    assert.equal(formatJoined('2026-01-01'), 'January 2026')
    assert.equal(formatJoined('2024-12-31'), 'December 2024')
  } finally {
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  }
  assert.equal(formatJoined(null), null)
  assert.equal(formatJoined('soon'), null)
})
