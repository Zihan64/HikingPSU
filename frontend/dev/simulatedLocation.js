// Dependency-free simulator for this development entry only. No real GPS calls.
export const SCENARIOS = [
  ['entrance','入口附近 · 精度 15 m'], ['far','远离入口'], ['coarse','精度不足 · 250 m'],
  ['denied','拒绝定位权限'], ['unavailable','定位不可用'], ['timeout','定位超时'],
]

export function createSimulatedLocation({delay = 150} = {}) {
  let trail = null, scenario = 'entrance', nextId = 0
  const watches = new Map()
  const permission = new EventTarget()
  permission.state = 'granted'

  function emit(id) {
    const watch = watches.get(id)
    if (!watch) return
    clearTimeout(watch.timer)
    watch.timer = setTimeout(() => {
      if (!watches.has(id)) return
      if (scenario === 'denied') {watch.error?.({code:1});return}
      if (scenario === 'timeout') {watch.error?.({code:3});return}
      if (!trail || scenario === 'unavailable') {watch.error?.({code:2});return}
      watch.success({coords:{latitude:trail.trailhead.lat + (scenario === 'far' ? 1 : 0),
        longitude:trail.trailhead.lon, accuracy:scenario === 'coarse' ? 250 : 15}, timestamp:Date.now()})
      if (scenario === 'coarse') {
        // Report a coarse fix, then fail this attempt so the real fallback/accuracy
        // handling can be tested without sitting through its 45-second timeout.
        if (watches.has(id)) watch.timer = setTimeout(() => {if (watches.has(id)) watch.error?.({code:2})}, delay)
      }
    },delay)
  }
  const geolocation = {
    watchPosition(success,error) {
      const id = ++nextId
      watches.set(id,{success,error,timer:null});emit(id);return id
    },
    clearWatch(id) {clearTimeout(watches.get(id)?.timer);watches.delete(id)},
    getCurrentPosition(success,error) {
      const id = geolocation.watchPosition(fix => {geolocation.clearWatch(id);success(fix)},
        reason => {geolocation.clearWatch(id);error?.(reason)})
    },
  }
  return {geolocation, permissions:{query:async () => permission},
    configure(nextTrail,nextScenario = 'entrance') {
      if (!SCENARIOS.some(([id]) => id === nextScenario)) throw new Error('Unknown location scenario')
      trail = nextTrail;scenario = nextScenario
      permission.state = scenario === 'denied' ? 'denied' : 'granted'
      permission.dispatchEvent(new Event('change'))
      for (const id of watches.keys()) emit(id)
    },
    snapshot:() => ({trailId:trail?.id,scenario}),
    dispose() {for (const id of watches.keys()) geolocation.clearWatch(id)},
  }
}
