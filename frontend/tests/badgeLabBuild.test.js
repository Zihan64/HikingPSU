import test from 'node:test'
import assert from 'node:assert/strict'
import badgeLabConfig from '../vite.badge-lab.config.js'
import developerConfig from '../vite.devtools.config.js'

test('the synthetic-auth simulator configuration cannot produce a deployable build',() => {
  assert.throws(() => badgeLabConfig({command:'build'}),/cannot be built or deployed/)
})

test('legacy standalone serving is disabled and the private build uses a separate artifact directory',() => {
  assert.throws(() => badgeLabConfig({command:'serve'}),/legacy config/)
  assert.throws(() => developerConfig({command:'serve'}),/authenticated developer gateway/)
  const privateBuild=developerConfig({command:'build'})
  assert.equal(privateBuild.build.outDir,'.devtools-dist')
  assert.notEqual(privateBuild.build.outDir,'dist')
  assert.equal(privateBuild.define['import.meta.env.VITE_API_BASE'],JSON.stringify('/__badge_lab_api'))
})
