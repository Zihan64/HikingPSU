import { useEffect, useState } from 'react'
import { listTrails } from '../api'
import { LEVEL_HEX, LEVEL_LABELS } from '../levels'

const STEP_MS = 5000

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// Frosted card that cycles through real trails from the backend.
// Hidden until /trails answers (Render's free tier can take a minute to wake up).
export default function TrailTicker({ className = '' }) {
  const [trails, setTrails] = useState([])
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const [still] = useState(prefersReducedMotion)

  useEffect(() => {
    let alive = true
    listTrails()
      .then(ts => {
        if (!alive) return
        // mix of levels reads better than easiest-first
        setTrails([...ts].sort((a, b) => (a.id < b.id ? -1 : 1)))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (still || paused || trails.length < 2) return
    const id = setTimeout(() => setI(n => (n + 1) % trails.length), STEP_MS)
    return () => clearTimeout(id)
  }, [i, paused, still, trails.length])

  if (!trails.length) return null
  const t = trails[i]
  const d = t.difficulty
  const carFree = trails.filter(x => x.car_free).length

  return (
    <div
      className={`${className} ${paused ? 'lp-paused' : ''} overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-[0_20px_50px_-20px_rgba(0,30,68,0.6)] backdrop-blur-xl`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-live="polite"
    >
      <div className="px-5 pb-4 pt-4">
        <p className="text-xs text-psu-slate">
          {trails.length} trails near campus, {carFree} without a car
        </p>
        <div key={t.id} className="lp-swap">
          <h3 className="mt-2 text-lg font-medium leading-snug text-psu-navy">{t.name}</h3>
          <p className="text-sm text-psu-slate">{t.area}</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-psu-navy/10 pt-3">
            <div>
              <dt className="text-xs text-psu-slate">Difficulty</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-psu-navy">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_HEX[d.level] }} />
                L{d.level} {LEVEL_LABELS[d.level]}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-psu-slate">Distance</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-psu-navy">{t.distance_mi} mi</dd>
            </div>
            <div>
              <dt className="text-xs text-psu-slate">Climbing</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-psu-navy">{t.elevation_gain_ft} ft</dd>
            </div>
          </dl>
        </div>
      </div>
      {!still && trails.length > 1 && (
        <div className="h-0.5 bg-psu-navy/10">
          <div key={`${t.id}-p`} className="lp-progress h-full bg-psu-navy/60" style={{ '--t': `${STEP_MS}ms` }} />
        </div>
      )}
    </div>
  )
}
