// Detailed silhouettes that live in the outdoor scene. Drawn to real proportions and backlit
// (the sun is ahead of the viewer), so they read as dark shapes with a warm rim of light.
// All motion is CSS (scene.css) and stops under prefers-reduced-motion.

/* ---------------- red-tailed hawk, soaring (seen from below) ---------------- */
// Head points along +x so `offset-rotate: auto` turns the bird as it circles.
function HawkShape() {
  const wing = 'M5 -3 C 10 -16, 10 -34, 7 -46 L 8.5 -53 L 5.2 -50.5 L 5.4 -57.5 L 2.4 -51.5 L 1.6 -58.5 L -0.8 -52 L -2.6 -57.2 L -4 -50.6 L -6.6 -54.6 L -7.4 -46.5 C -10.5 -36, -10.5 -18, -7.5 -3 Z'
  return (
    <g fill="#2b2420">
      <g className="hp-hawk-wing"><path d={wing} /></g>
      {/* mirrored wing: the mirror sits on an outer group so the CSS flex animation can't override it */}
      <g transform="scale(1 -1)"><g className="hp-hawk-wing hp-hawk-wing-b"><path d={wing} /></g></g>
      {/* body, head and fanned tail */}
      <path d="M23 0 C 22 -2.6, 18.5 -3.6, 14 -3.4 C 7 -4.6, -8 -4.2, -16 -3 L -29 -7.8 C -31.6 -3, -31.6 3, -29 7.8 L -16 3 C -8 4.2, 7 4.6, 14 3.4 C 18.5 3.6, 22 2.6, 23 0 Z" />
      <path d="M-27 -6 L -29 -2.2 M -27 6 L -29 2.2" stroke="rgba(160,70,40,0.6)" strokeWidth="1.4" />
    </g>
  )
}

export function Hawk({ className = '', size = 84 }) {
  return (
    <div className={`hp-hawk-orbit ${className}`} aria-hidden="true">
      <svg className="hp-hawk" viewBox="-34 -62 68 124" width={size * 0.55} height={size}>
        <HawkShape />
      </svg>
    </div>
  )
}

/* ---------------- distant birds ---------------- */
const FLOCKS = [
  { top: 6, dur: 58, delay: -12, scale: 0.9 },
  { top: 12, dur: 74, delay: -40, scale: 0.65 },
]
export function Flocks({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {FLOCKS.map((f, i) => (
        <div key={i} className="hp-flock" style={{ top: `${f.top}%`, '--dur': `${f.dur}s`, '--delay': `${f.delay}s` }}>
          <svg viewBox="0 0 80 30" width={80 * f.scale} height={30 * f.scale} className="overflow-visible">
            {[[2, 14, 1], [20, 6, 0.9], [36, 16, 0.8], [52, 9, 0.75], [64, 19, 0.7]].map(([x, y, s], j) => (
              <g key={j} transform={`translate(${x} ${y}) scale(${s})`}>
                <path
                  className="hp-wingbeat"
                  style={{ animationDelay: `${-j * 0.13}s` }}
                  d="M0 4 C 2.5 1.2, 5 0.4, 7.4 3.4 C 8 3.9, 8.6 3.9, 9.2 3.4 C 11.6 0.4, 14.1 1.2, 16.6 4"
                  fill="none" stroke="#24313a" strokeWidth="1.5" strokeLinecap="round"
                />
              </g>
            ))}
          </svg>
        </div>
      ))}
    </div>
  )
}

/* ---------------- white-tailed buck, grazing ---------------- */
// Side view facing left, hooves on y = 92, standing in a tuft of meadow grass. One continuous
// silhouette (the rim light is a filter on the whole shape, so no seams show). The neck is rooted
// deep in the shoulders and pivots at the withers, so lowering the head never opens a gap.
export function Deer({ className = '', style }) {
  return (
    <svg className={`hp-deer ${className}`} style={style} viewBox="0 -8 100 100" aria-hidden="true">
      <g fill="#33251a">
        {/* far legs, a shade darker */}
        <path fill="#271c13" d="M40 56 L 39.5 72 L 41.5 91 L 44 91 L 43.4 72 L 44.6 57 Z" />
        <path fill="#271c13" d="M69.5 52 C 72 60, 74.5 65, 72.5 72 L 74.6 91 L 77 91 L 76.4 72 C 78.6 64, 78 58, 75.6 51 Z" />
        {/* torso */}
        <path d="M27 47 C 27 37, 39 34, 53 34.5 C 64 35, 74 35.5, 77 43 C 78.5 51, 74 57.5, 63 58.2 C 51 59, 39 59, 33 56.4 C 28.5 54.5, 26.6 51, 27 47 Z" />
        {/* near legs */}
        <path d="M31.5 54 L 30.6 72 L 32.6 91 L 35.2 91 L 34.6 72 L 36.6 55.5 Z" />
        <path d="M63.5 53 C 65.5 61, 68 65.5, 66 72 L 68 91 L 70.5 91 L 70 72 C 72.2 65, 71.8 59, 69.6 52 Z" />
        {/* tail with a pale underside */}
        <g className="hp-deer-tail">
          <path d="M75.5 39.5 C 79.5 39, 82 42.5, 80.5 46.5 C 78 46, 76.4 43, 75.5 39.5 Z" />
          <path d="M77.6 43.6 C 79 44, 79.8 45, 80 46" stroke="#cdbfa8" strokeWidth="1" fill="none" />
        </g>
        {/* neck + head + antlers, pivoting at the withers (36, 42) */}
        <g className="hp-deer-head">
          <path d="M28 52 C 25 42, 21 32, 18.6 22 L 26.4 18.4 C 29.4 27, 35 34, 44 40 Z" />
          <path d="M19 22.4 C 16.2 17.2, 12.2 16, 8 17.6 C 4 19.2, 1 21.8, 1.4 24.2 C 1.9 26.2, 5.6 26.4, 9.6 25.8 C 14 25.4, 18.2 24.8, 21.6 21.6 Z" />
          <path className="hp-deer-ear" d="M20.2 17 L 27.8 12 L 24.6 18.8 Z" />
          <path d="M16.8 16.2 L 22.2 10 L 20.4 17.2 Z" />
          <g fill="none" stroke="#33251a" strokeWidth="1.5" strokeLinecap="round">
            <path d="M20 14.6 C 21 7.6, 26 2.6, 33.6 3.8" />
            <path d="M24 8 L 22.8 2 M 28 5 L 28.2 -1 M 31.4 3.8 L 33.6 -0.6" />
            <path d="M18.2 14.2 C 17.2 7.2, 21.2 1, 27.2 -0.2" strokeWidth="1.2" />
            <path d="M20.2 6.4 L 18 1.4 M 23.2 2 L 23 -3" strokeWidth="1.1" />
          </g>
        </g>
      </g>
      {/* meadow grass in front of the hooves: the head disappears into it while grazing */}
      <g fill="#2f3d1c">
        <path d="M-6 92 C 0 84, 2 78, 3 72 C 4.6 79, 6 84, 9 92 Z" />
        <path d="M2 92 C 6 82, 9 76, 12 70 C 12.6 78, 13 84, 16 92 Z" />
        <path d="M10 92 C 14 85, 17 80, 21 75 C 20.6 82, 21 87, 24 92 Z" />
        <path d="M-2 92 C 2 86, 5 83, 9 81 C 8 85, 8 88, 9 92 Z" fill="#46562a" />
        <path d="M14 92 C 17 87, 19 85, 23 83 C 22 87, 22 89, 23 92 Z" fill="#46562a" />
        <path d="M28 92 C 30 88, 32 86, 35 85 C 34 88, 34 90, 35 92 Z" />
        <path d="M60 92 C 62 87, 64 85, 67 84 C 66 87, 66 90, 67 92 Z" />
        <path d="M72 92 C 75 87, 77 85, 80 84 C 79 88, 79 90, 81 92 Z" fill="#46562a" />
      </g>
    </svg>
  )
}

/* ---------------- fully equipped hiker ---------------- */
// Side view walking right, boots on y = 100: wide-brim hat, softshell, big pack with sleeping-pad roll
// and side bottle, trekking poles, boots. Legs and poles swing in opposition.
export function Hiker({ className = '', style }) {
  return (
    <svg className={`hp-hiker ${className}`} style={style} viewBox="0 0 60 102" aria-hidden="true">
      <g strokeLinecap="round" strokeLinejoin="round">
        {/* back pole + back arm */}
        <g className="hp-pole-b">
          <path d="M24.6 27 L 21.4 38 L 19 45" stroke="#7d3220" strokeWidth="3.6" fill="none" />
          <path d="M19 45 L 12 99" stroke="#5b5f63" strokeWidth="1.3" />
        </g>
        {/* back leg */}
        <g className="hp-leg-b">
          <path d="M26 56 L 23.5 76 L 21.5 93" stroke="#2a2e33" strokeWidth="6.2" fill="none" />
          <path d="M17.5 93 L 25.5 92.5 L 27 98.5 L 17 99 Z" fill="#4a3424" />
        </g>
        {/* pack: main bag, lid, sleeping-pad roll, side bottle */}
        <path d="M8.6 21 C 6.2 30, 6 47, 9 57.5 L 22.6 57 L 23.6 21.5 C 18.6 18.4, 12.6 18.4, 8.6 21 Z" fill="#3d4a34" />
        <path d="M9 21 C 12 18.6, 19 18.4, 23.4 21.4 L 23 25.6 L 8.6 25.4 Z" fill="#2f3a28" />
        <rect x="6.2" y="12.6" width="18" height="8" rx="4" fill="#8a5a33" />
        <path d="M10 12.8 L 10 20.4 M 20 12.8 L 20 20.4" stroke="#5e3c22" strokeWidth="0.9" />
        <rect x="5" y="40" width="4.6" height="11" rx="1.8" fill="#9ab6c4" />
        {/* torso: softshell jacket */}
        <path d="M22.4 23 C 20.6 34, 21.4 46, 24.2 57 L 33 57 C 34.6 46, 33.8 34, 31 23 Z" fill="#a8452b" />
        <path d="M22.6 24 L 22.4 50" stroke="#6e2b1a" strokeWidth="1.4" />
        {/* front leg */}
        <g className="hp-leg-a">
          <path d="M29 56 L 32 76 L 31.2 93" stroke="#33383e" strokeWidth="6.4" fill="none" />
          <path d="M27 93 L 35.4 92.6 L 37.4 98.6 L 26.6 99 Z" fill="#5a3f2a" />
        </g>
        {/* head + hat */}
        <circle cx="27.6" cy="17.4" r="4.6" fill="#c89670" />
        <path d="M23 15.6 C 23 9, 32.6 9, 32.6 15.6 Z" fill="#8c7c58" />
        <path d="M18.6 15.8 C 22 14.4, 33.6 14.4, 37 15.8 C 33.6 17.4, 22 17.4, 18.6 15.8 Z" fill="#76684a" />
        {/* front arm + pole */}
        <g className="hp-pole-a">
          <path d="M30 26 L 35.6 38.6 L 40.4 43" stroke="#a8452b" strokeWidth="4" fill="none" />
          <path d="M40.4 43 L 48 99.5" stroke="#6d7175" strokeWidth="1.4" />
        </g>
      </g>
    </svg>
  )
}
