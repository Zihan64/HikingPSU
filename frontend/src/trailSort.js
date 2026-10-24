// Straight-line distance to the published trailhead, not a driving/hiking route.
export function distanceToTrail(trail, position) {
  const lat = position?.latitude, lon = position?.longitude
  const targetLat = trail.trailhead?.lat, targetLon = trail.trailhead?.lon
  if (![lat, lon, targetLat, targetLon].every(Number.isFinite)
    || Math.abs(lat) > 90 || Math.abs(targetLat) > 90
    || Math.abs(lon) > 180 || Math.abs(targetLon) > 180) return null
  const rad = Math.PI / 180
  const a = Math.sin((targetLat - lat) * rad / 2) ** 2
    + Math.cos(lat * rad) * Math.cos(targetLat * rad) * Math.sin((targetLon - lon) * rad / 2) ** 2
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))))
}

export function sortTrails(trails, mode, position) {
  if (mode !== 'nearest' || !position) return trails
  return trails.map(trail => ({trail, distance: distanceToTrail(trail, position) ?? Infinity}))
    .sort((a, b) => a.distance - b.distance).map(entry => entry.trail)
}
