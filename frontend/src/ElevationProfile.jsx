import { useState } from 'react'

export default function ElevationProfile({profile}) {
  const [selected, setSelected] = useState(null)
  if (!profile || profile.length < 2) return null
  const values = profile.map(p => p[1]), min = Math.min(...values), max = Math.max(...values)
  const length = profile.at(-1)[0], span = max - min || 1
  const x = p => 50 + p[0] / (length || 1) * 600, y = p => 155 - (p[1] - min) / span * 130
  const path = profile.map((p, i) => `${i ? 'L' : 'M'}${x(p)},${y(p)}`).join(' ')
  const sample = selected === null ? null : profile[selected]
  function inspect(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const miles = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * 680 - 50) / 600)) * length
    setSelected(profile.reduce((best, p, i) => Math.abs(p[0] - miles) < Math.abs(profile[best][0] - miles) ? i : best, 0))
  }
  return <section className="catalog-section"><h2>Elevation profile</h2>
    <svg viewBox="0 0 680 190" role="img" aria-label={`Elevation from ${Math.round(min)} to ${Math.round(max)} feet over ${length.toFixed(1)} miles`} onPointerMove={inspect} onPointerDown={inspect}>
      <path d={`${path} L${x(profile.at(-1))},160 L50,160 Z`} fill="#dcebd5" />
      <path d={path} fill="none" stroke="#2f6b47" strokeWidth="2.5" />
      <text x="0" y="25">{Math.round(max)} ft</text><text x="0" y="158">{Math.round(min)} ft</text>
      <text x="50" y="185">0 mi</text><text x="650" y="185" textAnchor="end">{length.toFixed(1)} mi</text>
      {sample && <circle cx={x(sample)} cy={y(sample)} r="5" fill="#173a40" />}
    </svg>
    {sample && <p>{sample[0].toFixed(2)} mi · {Math.round(sample[1])} ft</p>}
    <p className="catalog-muted">Approximate elevation from a ~90 m DEM. This is a terrain reference, not a surveyed profile.</p>
  </section>
}
