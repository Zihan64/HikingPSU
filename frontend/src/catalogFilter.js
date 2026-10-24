export function filterCatalog(trails, {parkId = 'all', query = '', sort = 'name'} = {}) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return trails.filter(t => (parkId === 'all' || (t.park_id || 'other-nearby-trails') === parkId)
    && tokens.every(word => [t.name, t.park_name, t.area, ...(t.features || [])].join(' ').toLowerCase().includes(word)))
    .sort((a, b) => (sort === 'difficulty' ? a.difficulty.level - b.difficulty.level || a.distance_mi - b.distance_mi
      : sort === 'distance' ? a.distance_mi - b.distance_mi : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function formatTime(minutes) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return [hours ? `${hours} h` : '', rest || !hours ? `${rest} min` : ''].filter(Boolean).join(' ')
}

export function routeType(trail) {
  return trail.loop ? 'Loop' : /one-way length/.test(trail.notes || '') ? 'One-way · out-and-back ≈ 2×' : 'Out-and-back'
}
