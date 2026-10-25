import test from 'node:test'
import assert from 'node:assert/strict'
import badgeLabConfig from '../vite.badge-lab.config.js'

test('the synthetic-auth simulator configuration cannot produce a deployable build',() => {
  assert.throws(() => badgeLabConfig({command:'build'}),/cannot be built or deployed/)
})
