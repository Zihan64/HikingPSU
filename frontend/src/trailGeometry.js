// Platform-independent geometry/reference logic. No DOM, map SDK, GPS API,
// route files, routing engine, invented connectors or inferred turn commands.
const R = 6371008.8
const rad = value => value * Math.PI / 180
const key = point => `${point[0].toFixed(8)},${point[1].toFixed(8)}`

export function distanceMeters(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)))
}

export function lineLength(points) {
  return points.slice(1).reduce((sum, point, i) => sum + distanceMeters(points[i], point), 0)
}

export function prepareRouteReference(collection, reverse = false) {
  const lines = []
  for (const feature of collection.features || []) {
    const geometry = feature.geometry || {}
    if (!['LineString', 'MultiLineString'].includes(geometry.type)) throw new Error('Only official line geometry can be displayed.')
    const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
    for (const coords of parts) {
      if (!Array.isArray(coords) || coords.length < 2 || coords.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error('The official source returned invalid coordinates.')
      const length = lineLength(coords)
      if (length > 0) lines.push({ coords, name: feature.properties?.Name?.trim() || 'Official mapped trail', length })
    }
  }
  if (!lines.length) throw new Error('No usable official trail geometry was returned.')
  const lengthMeters = lines.reduce((sum, line) => sum + line.length, 0)
  const nodes = new Map()
  lines.forEach((line, id) => {
    for (const point of [line.coords[0], line.coords.at(-1)]) {
      const name = key(point)
      if (!nodes.has(name)) nodes.set(name, [])
      nodes.get(name).push(id)
    }
  })
  const ends = [...nodes].filter(([, edges]) => edges.length === 1)
  const invalid = [...nodes.values()].some(edges => edges.length > 2) || ![0, 2].includes(ends.length)
  const unavailable = () => ({ connected: false, loop: false, lines, lengthMeters, coordinates: [], steps: [], reason: 'The source contains branches or disconnected segments. Overlay only: no continuous route order is inferred.' })
  if (invalid) return unavailable()
  let current = ends.length ? ends[0][0] : key(lines[0].coords[0])
  const used = new Set(), ordered = []
  while (used.size < lines.length) {
    const id = (nodes.get(current) || []).find(i => !used.has(i))
    if (id === undefined) return unavailable()
    const line = lines[id]
    const coords = key(line.coords[0]) === current ? [...line.coords] : [...line.coords].reverse()
    ordered.push({ ...line, coords })
    used.add(id)
    current = key(coords.at(-1))
  }
  if (reverse) ordered.reverse().forEach(line => line.coords.reverse())
  const coordinates = [], steps = []
  let offset = 0
  for (const line of ordered) {
    coordinates.push(...(coordinates.length ? line.coords.slice(1) : line.coords))
    steps.push({ name: line.name, lengthMeters: line.length, startMeters: offset, endMeters: offset + line.length })
    offset += line.length
  }
  return { connected: true, loop: ends.length === 0, lines, coordinates, steps, lengthMeters, reason: null }
}

function project(point, a, b) {
  const cos = Math.cos(rad((a[1] + b[1]) / 2))
  const dx = rad(b[0] - a[0]) * cos * R, dy = rad(b[1] - a[1]) * R
  const px = rad(point[0] - a[0]) * cos * R, py = rad(point[1] - a[1]) * R
  const fraction = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)))
  const nearest = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]
  return { fraction, distance: distanceMeters(point, nearest) }
}

export function locateOnRoute(reference, position, now = Date.now()) {
  if (!position) return { status: 'no_position' }
  if (!Number.isFinite(position.timestamp) || now - position.timestamp > 45000 || position.timestamp - now > 10000) return { status: 'stale' }
  if (!Number.isFinite(position.latitude) || Math.abs(position.latitude) > 90 || !Number.isFinite(position.longitude) || Math.abs(position.longitude) > 180 || !Number.isFinite(position.accuracy) || position.accuracy < 0) return { status: 'poor_accuracy' }
  let best = { distance: Infinity, along: 0 }, traversed = 0
  const lines = reference.connected ? [{ coords: reference.coordinates }] : reference.lines
  for (const line of lines) {
    for (let i = 1; i < line.coords.length; i++) {
      const length = distanceMeters(line.coords[i - 1], line.coords[i])
      const projected = project([position.longitude, position.latitude], line.coords[i - 1], line.coords[i])
      if (projected.distance < best.distance) best = { distance: projected.distance, along: traversed + length * projected.fraction }
      traversed += length
    }
  }
  const detail = { distanceToRouteMeters: best.distance, accuracyMeters: position.accuracy }
  if (position.accuracy > 60) return { ...detail, status: 'poor_accuracy' }
  if (best.distance > position.accuracy + 35) return { ...detail, status: 'off_route' }
  if (best.distance > Math.max(15, position.accuracy)) return { ...detail, status: 'uncertain' }
  const step = reference.steps.findIndex(s => best.along <= s.endMeters)
  return { ...detail, status: 'near_route', alongMeters: reference.connected ? best.along : null,
    remainingMeters: reference.connected ? Math.max(0, reference.lengthMeters - best.along) : null, stepIndex: step }
}

export function formatMeters(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}
