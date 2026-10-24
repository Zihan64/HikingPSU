// Cancellable one-fix or explicitly enabled foreground live location.
// No network requests or storage here.
// The browser chooses the actual provider; high accuracy is a preference, not
// a guarantee that GPS hardware was used.
export function createLocationController({ geolocation, permissions, secureContext, policyAllowed = true }) {
  const unavailable = !secureContext
    ? 'Location needs a secure connection. Open this site over HTTPS, or use localhost for development.'
    : !geolocation
      ? 'This browser does not support device location. You can still explore all trails.'
      : !policyAllowed
        ? 'Location is blocked by this page. Open the site directly in your browser and try again.'
        : null
  let state = { status: unavailable ? 'unavailable' : 'idle', permission: 'unknown', position: null, error: unavailable, tracking: false }
  const listeners = new Set()
  let watchId = null
  let requestVersion = 0
  let connectionVersion = 0
  let permissionStatus = null
  let permissionListener = null
  let fixId = 0

  function update(changes) {
    state = { ...state, ...changes }
    listeners.forEach(listener => listener())
  }

  function stopWatch() {
    if (watchId !== null) {
      geolocation.clearWatch(watchId)
      watchId = null
    }
  }

  function cancel() {
    requestVersion++
    stopWatch()
    update({ status: unavailable ? 'unavailable' : 'idle', position: null, error: unavailable, tracking: false })
  }

  function stopTracking() {
    if (!state.tracking) return
    requestVersion++
    stopWatch()
    update({ tracking: false, status: state.position ? 'ready' : 'idle' })
  }

  function request({ continuous = false } = {}) {
    if (unavailable) return
    if (state.status === 'locating' || state.status === 'fallback' || state.tracking) return
    if (state.permission === 'denied' && (!permissionStatus || permissionStatus.state === 'denied')) {
      update({ status: 'denied', error: 'Location access is blocked. Allow location for this site in your browser settings and check that device Location Services are on, then try again.' })
      return
    }
    const version = ++requestVersion
    stopWatch()
    update({ status: 'locating', position: null, error: null, permission: permissionStatus?.state || state.permission, tracking: continuous })

    function attempt(highAccuracy) {
      if (version !== requestVersion) return
      let completed = false
      let returnedId
      const success = result => {
        if (version !== requestVersion || completed) return
        const { latitude, longitude, accuracy } = result.coords || {}
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
            || !Number.isFinite(longitude) || Math.abs(longitude) > 180
            || !Number.isFinite(accuracy) || accuracy < 0) {
          failure({ code: 2 })
          return
        }
        if (!continuous) { completed = true; stopWatch() }
        update({
          status: 'ready', permission: 'granted', error: null, tracking: continuous,
          position: { latitude, longitude, accuracy, timestamp: result.timestamp, id: ++fixId },
        })
      }
      const failure = error => {
        if (version !== requestVersion || completed) return
        completed = true
        stopWatch()
        if (error.code === 1) {
          update({ status: 'denied', permission: 'denied', position: null, tracking: false, error: 'Location was not allowed. Allow location for this site in your browser settings and check that device Location Services are on, then try again.' })
        } else if (highAccuracy && (error.code === 2 || error.code === 3)) {
          update({ status: 'fallback' })
          attempt(false)
        } else {
          update({
            status: 'error', position: null, tracking: false,
            error: error.code === 3
              ? 'Location timed out. Check your connection and device Location Services, or try again outdoors.'
              : 'Your location is unavailable. Check your connection and device Location Services, then try again.',
          })
        }
      }
      try {
        returnedId = geolocation.watchPosition(success, failure, {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 15000 : 10000,
          maximumAge: 0,
        })
        // Also handle synchronous callback implementations in tests or webviews.
        if (completed || version !== requestVersion) geolocation.clearWatch(returnedId)
        else watchId = returnedId
      } catch {
        failure({ code: 2 })
      }
    }
    attempt(true)
  }

  function connect() {
    const version = ++connectionVersion
    if (!unavailable && permissions?.query) {
      Promise.resolve().then(() => permissions.query({ name: 'geolocation' })).then(status => {
        if (version !== connectionVersion) return
        permissionStatus = status
        permissionListener = () => {
          if (version !== connectionVersion) return
          if (status.state === 'denied') {
            requestVersion++
            stopWatch()
            update({ permission: 'denied', status: 'denied', position: null, tracking: false, error: 'Location access is blocked. Allow location for this site in your browser settings to use your location.' })
          } else {
            const revoked = status.state === 'prompt' && state.permission === 'granted'
            if (revoked) { requestVersion++; stopWatch() }
            update({ permission: status.state, ...(revoked ? { status: 'idle', position: null, error: null, tracking: false } : state.status === 'denied' ? { status: 'idle', error: null } : {}) })
          }
        }
        status.addEventListener?.('change', permissionListener)
        permissionListener()
      }).catch(() => { /* Permissions API is optional; requesting location still works. */ })
    }
    return () => {
      connectionVersion++
      cancel()
      permissionStatus?.removeEventListener?.('change', permissionListener)
      permissionStatus = null
      permissionListener = null
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    connect, request, cancel, clear: cancel, startTracking: () => request({ continuous: true }), stopTracking,
  }
}

export function formatAccuracy(meters) {
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m`
  return `${(meters / 1000).toFixed(1)} km`
}
