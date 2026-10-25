import { useEffect, useId, useMemo, useRef } from 'react'
import { W, H, ridgeFn, ridgePath, forestPath, riverPaths } from './terrain'
import { Deer, Flocks, Hawk, Hiker } from './Wildlife'
import './scenery.css'

// Layered landscape in the style of landscape photography and Nordic posters: realism comes from
// atmosphere (aerial perspective, valley mist, backlight and light shafts), not from texture.
// Every layer is its own element, so motion is transform/opacity only (GPU-composited, cheap).
// Shapes are generated once per page load (seeded, so they never change between visits).

/* ------------------------------ sky ------------------------------ */

export function Sun({ className = '', style, shafts = 7, strength = 1 }) {
  return (
    <div className={`sc-sun ${className}`} style={{ ...style, '--sun-strength': strength }} aria-hidden="true">
      <div className="sc-sun-glow" />
      {/* Tyndall effect: soft beams of light fanning down through the hazy air */}
      <div className="sc-shafts">
        {Array.from({ length: shafts }, (_, i) => (
          <span
            key={i}
            className="sc-beam"
            style={{
              '--angle': `${-34 + i * (92 / Math.max(1, shafts - 1))}deg`,
              '--beam-w': `${46 + ((i * 37) % 5) * 22}px`,
              '--beam-delay': `${-i * 1.9}s`,
              '--beam-dur': `${9 + (i % 4) * 2.5}s`,
            }}
          />
        ))}
      </div>
      <div className="sc-sun-core" />
    </div>
  )
}

// A cumulus: clustered lumps roughened by fractal noise, white crown over a blue-grey base.
export function Cloud({ width = 420, seed = 3, className = '', style }) {
  const id = useId().replace(/:/g, '')
  const lumps = useMemo(() => {
    let a = seed * 9973
    const r = () => ((a = (a * 16807) % 2147483647) / 2147483647)
    const out = [{ cx: 210, cy: 118, rx: 170, ry: 34 }]                           // flat base
    for (let i = 0; i < 6; i++) out.push({ cx: 80 + i * 52 + r() * 30, cy: 96 - r() * 30, rx: 40 + r() * 36, ry: 36 + r() * 30 })
    out.push({ cx: 190 + r() * 60, cy: 62 - r() * 16, rx: 52 + r() * 18, ry: 46 + r() * 12 })   // crown
    return out
  }, [seed])
  return (
    <svg className={`sc-cloud ${className}`} style={style} viewBox="0 0 420 170" width={width} aria-hidden="true">
      <defs>
        <filter id={`f${id}`} x="-20%" y="-30%" width="140%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="3" seed={seed} />
          <feDisplacementMap in="SourceGraphic" scale="44" />
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#f6f4ee" />
          <stop offset="1" stopColor="#c9d4df" />
        </linearGradient>
      </defs>
      <g filter={`url(#f${id})`}>
        {lumps.map((l, i) => <ellipse key={`s${i}`} cx={l.cx} cy={l.cy + 10} rx={l.rx} ry={l.ry} fill="#b9c7d5" opacity="0.55" />)}
        {lumps.map((l, i) => <ellipse key={i} cx={l.cx} cy={l.cy} rx={l.rx} ry={l.ry} fill={`url(#g${id})`} />)}
      </g>
    </svg>
  )
}

/* ------------------------------ land ------------------------------ */

function useTerrain() {
  return useMemo(() => {
    const far = ridgeFn({ seed: 11, base: 150, amp: 78, freq: 3.3, flat: 0.6 })
    const far2 = ridgeFn({ seed: 23, base: 205, amp: 74, freq: 4.5, flat: 0.55 })
    const mid = ridgeFn({ seed: 37, base: 268, amp: 58, freq: 5.7, flat: 0.5 })
    const near = ridgeFn({ seed: 41, base: 338, amp: 46, freq: 6.9, flat: 0.4 })
    const valley = x => 404 + Math.sin(x / 260) * 6
    const front = x => 610 - Math.sin(x / 210) * 10
    return {
      far: ridgePath(far),
      far2: ridgePath(far2),
      mid: forestPath(mid, { seed: 5, minH: 7, maxH: 16, spacing: 6, broadleaf: 0.22 }),
      near: forestPath(near, { seed: 9, minH: 16, maxH: 38, spacing: 11, broadleaf: 0.26 }),
      valley: ridgePath(valley, 20),
      river: riverPaths({ seed: 7, x0: 1290, y0: 408, x1: 1180, y1: H + 12, w0: 5, w1: 240 }),
      front: forestPath(front, { seed: 17, minH: 130, maxH: 300, spacing: 40, broadleaf: 0.12, gap: [760, 1720] }),
    }
  }, [])
}

function LandLayer({ depth, className = '', children, defs }) {
  return (
    <svg className={`sc-land ${className}`} style={{ '--depth': depth }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {defs && <defs>{defs}</defs>}
      {children}
    </svg>
  )
}

function grad(id, top, bottom) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={top} />
      <stop offset="1" stopColor={bottom} />
    </linearGradient>
  )
}

// Writes the pointer as --mx/--my (-1..1) on the scenery root; each land layer moves by its depth.
function usePointerParallax(ref, enabled) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return } catch { /* old browsers */ }
    let raf = 0, x = 0, y = 0
    const onMove = e => {
      x = (e.clientX / window.innerWidth) * 2 - 1
      y = (e.clientY / window.innerHeight) * 2 - 1
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        el.style.setProperty('--mx', x.toFixed(3))
        el.style.setProperty('--my', y.toFixed(3))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf) }
  }, [ref, enabled])
}

/**
 * Full landscape for the sign-in page. The land is `var(--land)` tall at the bottom of the box,
 * the sky fills the rest. Children render above the land (wildlife).
 */
export function HeroScenery({ className = '', children }) {
  const t = useTerrain()
  const root = useRef(null)
  usePointerParallax(root, true)
  return (
    <div ref={root} className={`sc-hero ${className}`} aria-hidden="true">
      <div className="sc-sky" />
      <div className="sc-skybox">
        <Sun className="sc-sun-hero" />
        <div className="sc-drift" style={{ top: '12%', '--dur': '230s', '--delay': '-60s' }}><Cloud width={460} seed={3} /></div>
        <div className="sc-drift" style={{ top: '27%', '--dur': '300s', '--delay': '-190s' }}><Cloud width={300} seed={8} /></div>
        <div className="sc-drift sc-drift-far" style={{ top: '40%', '--dur': '360s', '--delay': '-120s' }}><Cloud width={220} seed={14} /></div>
        <Flocks />
        <Hawk className="hidden sm:block sm:left-[52%] sm:top-[40%] lg:left-[46%] lg:top-[36%]" size={58} />
      </div>

      <LandLayer depth={3} defs={grad('scFar', '#a8bfcb', '#c9d5d2')}><path d={t.far} fill="url(#scFar)" /></LandLayer>
      <LandLayer depth={5} defs={grad('scFar2', '#8eaaa8', '#b2c3b8')}><path d={t.far2} fill="url(#scFar2)" /></LandLayer>
      <div className="sc-mist" style={{ bottom: 'calc(var(--land) * 0.52)' }} />
      <LandLayer depth={8} defs={grad('scMid', '#5f8a6c', '#86a385')}>
        <path d={t.mid.body} fill="url(#scMid)" />
        <path d={t.mid.crowns} fill="#a58456" opacity="0.75" />
      </LandLayer>
      <div className="sc-mist sc-mist-b" style={{ bottom: 'calc(var(--land) * 0.36)' }} />
      <LandLayer depth={12} defs={grad('scNear', '#3e6c4b', '#5b8257')}>
        <path d={t.near.body} fill="url(#scNear)" />
        <path d={t.near.crowns} fill="#9a6a38" opacity="0.85" />
      </LandLayer>
      <LandLayer
        depth={16}
        className="sc-valley"
        defs={<>
          {grad('scMeadow', '#7f9b5c', '#5f7d43')}
          <linearGradient id="scWater" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#dbe7ea" />
            <stop offset="0.45" stopColor="#a9c9d6" />
            <stop offset="1" stopColor="#6f9fb4" />
          </linearGradient>
        </>}
      >
        <path d={t.valley} fill="url(#scMeadow)" />
        <path d={t.river.outline} fill="url(#scWater)" />
        <path d={t.river.outline} fill="none" stroke="#4d6b45" strokeOpacity="0.35" strokeWidth="3" />
      </LandLayer>
      <LandLayer depth={16}>
        {t.river.lanes.map((d, i) => (
          <path key={i} className={`sc-current sc-current-${i}`} d={d} fill="none" stroke="#ffffff" strokeLinecap="round" />
        ))}
        {/* meadow life, drawn in the land frame so it always stands on the grass */}
        <Deer x="985" y="452" width="96" height="96" />
        <g className="sc-trek"><Hiker x="760" y="478" width="44" height="76" /></g>
      </LandLayer>
      <LandLayer
        depth={22}
        className="sc-front"
        defs={<linearGradient id="scFront" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1d3324" />
          <stop offset="0.5" stopColor="#21392a" />
          <stop offset="1" stopColor="#2b4630" />
        </linearGradient>}
      >
        <path d={t.front.body} fill="url(#scFront)" />
        <path d="M-40 588 C 450 580, 1050 592, 1500 590 C 1880 588, 2180 582, 2440 584 L2440 600 L-40 600 Z" fill="#3d2f22" />
      </LandLayer>
      {children}
      <div className="sc-grain" />
    </div>
  )
}

/** Calm sky strip for the top of the app: warm-blue sky, sun and light shafts, two clouds, far ridges. */
export function SkyBand({ className = '' }) {
  const t = useTerrain()
  return (
    <div className={`sc-band ${className}`} aria-hidden="true">
      <div className="sc-band-sky" />
      <Sun className="sc-sun-band" shafts={5} strength={0.75} />
      <div className="sc-drift" style={{ top: '8%', '--dur': '260s', '--delay': '-40s' }}><Cloud width={300} seed={4} /></div>
      <div className="sc-drift" style={{ top: '30%', '--dur': '340s', '--delay': '-210s' }}><Cloud width={200} seed={12} /></div>
      <svg className="sc-band-ridges" viewBox={`0 60 ${W} ${H - 60}`} preserveAspectRatio="xMidYMin slice">
        <path d={t.far} fill="#c5d4dc" opacity="0.8" />
        <path d={t.far2} fill="#b5c8c3" opacity="0.75" />
        <path d={t.mid.body} fill="#9fb9a2" opacity="0.7" />
      </svg>
    </div>
  )
}

/** Soft forest silhouettes along the bottom edge of the app. */
export function ForestBand({ className = '' }) {
  const t = useTerrain()
  return (
    <svg className={`sc-forest-band ${className}`} viewBox={`0 170 ${W} ${H - 170}`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <path d={t.mid.body} fill="#d3ddd0" />
      <path d={t.near.body} fill="#b9cab4" />
    </svg>
  )
}
