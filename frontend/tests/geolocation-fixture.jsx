// Development-only fixture: exercise real UI and map code with public test
// coordinates. Never imported by the production entry point.
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/App'
import 'leaflet/dist/leaflet.css'
import '../src/index.css'

if (!import.meta.env.DEV) throw new Error('Geolocation fixture is only available during local development.')

const scenario = new URLSearchParams(location.search).get('scenario') || 'success'
const timers = new Map()
let nextId = 0
const permission = new EventTarget()
permission.state = 'prompt'

Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
  query: async () => permission,
} })
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
  watchPosition(success, error, options) {
    const id = nextId++
    const timer = setTimeout(() => {
      if (scenario === 'denied') error({ code: 1 })
      else if (scenario === 'timeout') error({ code: 3 })
      else if (scenario === 'unavailable') error({ code: 2 })
      else if (scenario === 'fallback' && options.enableHighAccuracy) error({ code: 2 })
      else success({
        coords: { latitude: scenario === 'outside' ? 40.4406 : scenario === 'on-route' ? 40.682666821650713 : 40.7934, longitude: scenario === 'outside' ? -79.9959 : scenario === 'on-route' ? -77.865863318553352 : -77.86, accuracy: scenario === 'fallback' ? 2500 : 24 },
        timestamp: Date.now(),
      })
    }, scenario === 'pending' ? 10000 : 300)
    timers.set(id, timer)
    return id
  },
  clearWatch(id) { clearTimeout(timers.get(id)); timers.delete(id) },
} })

createRoot(document.getElementById('root')).render(<App />)
