import test from 'node:test'
import assert from 'node:assert/strict'
import {createSimulatedLocation} from '../dev/simulatedLocation.js'
import {requestOneFix} from '../src/checkin.js'

const trail={id:'test',trailhead:{lat:40.8,lon:-77.8}}
function fix(sim,signal) {return requestOneFix({geolocation:sim.geolocation,permissions:sim.permissions,secureContext:true,timeoutMs:500,signal})}

test('simulated entrance/far positions run through the actual location controller',async () => {
  const sim=createSimulatedLocation({delay:1})
  try {
    sim.configure(trail)
    assert.deepEqual(await fix(sim),{latitude:40.8,longitude:-77.8,accuracy:15})
    sim.configure(trail,'far')
    assert.equal((await fix(sim)).latitude,41.8)
  } finally {sim.dispose()}
})

test('coarse location is refused by the real accuracy/fallback logic',async () => {
  const sim=createSimulatedLocation({delay:1})
  try {sim.configure(trail,'coarse');await assert.rejects(fix(sim),/250 m|100 m/)}
  finally {sim.dispose()}
})

test('denial, unavailability and timeout fail, and a later valid scenario recovers',async () => {
  const sim=createSimulatedLocation({delay:1})
  try {
    for (const scenario of ['denied','unavailable','timeout']) {
      sim.configure(trail,scenario)
      await assert.rejects(fix(sim))
    }
    sim.configure(trail)
    assert.equal((await fix(sim)).accuracy,15)
  } finally {sim.dispose()}
})

test('cancelled requests never succeed later and scenario names are validated',async () => {
  const sim=createSimulatedLocation({delay:10}),abort=new AbortController()
  try {
    sim.configure(trail)
    const promise=fix(sim,abort.signal);abort.abort()
    await assert.rejects(promise,{name:'AbortError'})
    assert.throws(() => sim.configure(trail,'not-a-scenario'),/Unknown/)
  } finally {sim.dispose()}
})
