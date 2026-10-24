// Outdoor scene shared by the sign-in page and the app backdrop.
//   Sky (top): sun with turning rays and a breathing glow, drifting clouds, small flocks of birds.
//   Land (bottom): Central PA ridges (long and flat-topped like Tussey Mountain, with the rounded
//   Mount Nittany knob), a river with moving light and a stream joining it, green pines and
//   autumn trees on brown trunks, warm earth at the very bottom.
// Every layer sits in a .lp-par group, so the sign-in page's pointer parallax gives it depth.
// All motion lives in landing.css and stops under prefers-reduced-motion.

/* ------------------------------ sky ------------------------------ */

function Cloud({ width, opacity = 1 }) {
  // flat-bottomed fair-weather cumulus
  return (
    <svg viewBox="0 0 200 80" width={width} style={{ opacity }} aria-hidden="true">
      <path
        d="M14 72 C 6 72, 4 56, 18 52 C 16 36, 34 28, 46 34 C 52 14, 82 8, 96 26 C 108 12, 138 14, 142 36 C 160 30, 178 42, 172 56 C 190 56, 194 72, 182 72 Z"
        fill="#fff"
      />
    </svg>
  )
}

// top = % from the top; dur/delay in seconds (negative delay = already mid-flight on load)
const CLOUDS = [
  { top: 9, width: 240, dur: 130, delay: -95, opacity: 0.95, depth: 22 },
  { top: 17, width: 120, dur: 170, delay: -40, opacity: 0.75, depth: 10 },
  { top: 30, width: 320, dur: 110, delay: -20, opacity: 0.9, depth: 28 },
  { top: 44, width: 160, dur: 150, delay: -120, opacity: 0.7, depth: 14 },
  { top: 55, width: 100, dur: 190, delay: -70, opacity: 0.6, depth: 8 },
]

export function Clouds() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {CLOUDS.map((c, i) => (
        <div key={i} className="lp-par absolute inset-0" style={{ '--px': -c.depth, '--py': -c.depth / 4 }}>
          <div className="lp-cloud absolute left-0 right-0" style={{ top: `${c.top}%`, '--dur': `${c.dur}s`, '--delay': `${c.delay}s` }}>
            <Cloud width={c.width} opacity={c.opacity} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Sun: warm core, a slowly turning ring of rays, and a glow that breathes.
export function Sun({ className = '' }) {
  return (
    <div className={`lp-sun ${className}`} aria-hidden="true">
      <div className="lp-sun-glow" />
      <svg className="lp-sun-rays" viewBox="-100 -100 200 200">
        {Array.from({ length: 16 }, (_, i) => (
          <path
            key={i}
            d={i % 2 ? 'M-2.4 -50 L0 -78 L2.4 -50 Z' : 'M-3.4 -50 L0 -94 L3.4 -50 Z'}
            transform={`rotate(${i * 22.5})`}
            fill="#FFD666"
            opacity={i % 2 ? 0.45 : 0.6}
          />
        ))}
      </svg>
      <div className="lp-sun-core" />
    </div>
  )
}

// Small flocks crossing the sky, wings beating out of step.
// top = % of the sky box; kept high so flocks pass above headlines, not through them
const FLOCKS = [
  { top: 3, dur: 46, delay: -8, scale: 1 },
  { top: 8.5, dur: 62, delay: -30, scale: 0.75 },
  { top: 6, dur: 74, delay: -55, scale: 0.6 },
]

export function Birds() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {FLOCKS.map((f, i) => (
        <div key={i} className="lp-flock absolute left-0 right-0" style={{ top: `${f.top}%`, '--dur': `${f.dur}s`, '--delay': `${f.delay}s` }}>
          <svg viewBox="0 0 64 26" width={64 * f.scale} height={26 * f.scale} className="overflow-visible">
            {[[2, 12], [22, 4], [40, 15]].map(([x, y], j) => (
              <g key={j} transform={`translate(${x} ${y})`}>
                <path
                  className="lp-wing"
                  style={{ animationDelay: `${-j * 0.17}s` }}
                  d="M0 5 Q 5.5 0 11 5 Q 16.5 0 22 5"
                  fill="none" stroke="#2B4A5E" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
                />
              </g>
            ))}
          </svg>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------ land ------------------------------ */

// Top edge of the foreground meadow, for planting trees on it (x -> y, piecewise linear).
const MEADOW = [[0, 262], [400, 256], [640, 262], [860, 268], [1100, 256], [1340, 254], [1600, 258]]
function groundY(x) {
  for (let i = 1; i < MEADOW.length; i++) {
    const [x0, y0] = MEADOW[i - 1]
    const [x1, y1] = MEADOW[i]
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
  }
  return MEADOW[MEADOW.length - 1][1]
}

// Deterministic forest, clear of the river (x ~ 700–980 near the bottom).
// kind: 'pine' (greens) or 'leaf' (autumn crowns). [x, height, kind, colour]
const PINE_GREENS = ['#2F6B47', '#3A7A4E', '#285C3E']
const AUTUMN = ['#D2873C', '#C0662E', '#E2AE48', '#B9753A']
const TREES = Array.from({ length: 46 }, (_, i) => {
  const x = 18 + i * 34 + ((i * 41) % 17)
  const h = 26 + ((i * 53) % 22)
  const autumn = i % 4 === 1 || i % 7 === 3
  return [x, h, autumn ? 'leaf' : 'pine', autumn ? AUTUMN[i % AUTUMN.length] : PINE_GREENS[i % PINE_GREENS.length]]
}).filter(([x]) => x < 690 || x > 990)

function Tree({ x, h, kind, color, i }) {
  const base = groundY(x) + 2
  const trunkH = kind === 'pine' ? h * 0.18 : h * 0.34
  const style = { '--sway-delay': `${-(i % 7) * 0.7}s`, '--sway-dur': `${4.5 + (i % 5)}s` }
  return (
    <g className="lp-tree" style={style}>
      <rect x={x - 1.6} y={base - trunkH} width="3.2" height={trunkH} rx="1" fill="#7A5434" />
      {kind === 'pine' ? (
        <>
          <path d={`M${x} ${base - h} L${x + h * 0.3} ${base - trunkH - h * 0.28} L${x - h * 0.3} ${base - trunkH - h * 0.28} Z`} fill={color} />
          <path d={`M${x} ${base - h * 0.72} L${x + h * 0.38} ${base - trunkH} L${x - h * 0.38} ${base - trunkH} Z`} fill={color} />
        </>
      ) : (
        <>
          <circle cx={x} cy={base - trunkH - h * 0.3} r={h * 0.32} fill={color} />
          <circle cx={x - h * 0.16} cy={base - trunkH - h * 0.16} r={h * 0.22} fill={color} opacity="0.9" />
        </>
      )}
    </g>
  )
}

// River: a ribbon that widens toward us; the stream joins it from the left.
const RIVER = 'M878 168 C 850 192, 940 202, 905 220 C 870 238, 720 242, 745 266 C 765 288, 840 292, 830 302 L 932 302 C 950 290, 840 284, 815 266 C 800 248, 935 242, 955 220 C 985 198, 875 190, 884 168 Z'
const RIVER_FLOW = 'M881 168 C 862 192, 948 202, 930 220 C 900 240, 760 244, 780 266 C 800 286, 880 292, 880 302'
const STREAM = 'M470 240 C 540 244, 610 252, 680 258 C 720 262, 750 264, 770 266'

export function Landscape({ className = '', rise = true }) {
  const r = (d) => (rise ? { className: 'lp-rise', style: { '--d': `${d}s` } } : {})
  return (
    <svg viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden="true">
      {/* far ridge in blue-green haze: where the sky turns into land */}
      <g className="lp-par" style={{ '--px': 4, '--py': 1.5 }}>
        <path {...r(0.1)} d="M0 128 C 90 112, 170 86, 260 82 L 640 74 C 720 74, 770 110, 850 118 C 940 126, 1020 96, 1110 90 L 1600 84 V300 H0 Z" fill="#A9CBC4" />
      </g>
      {/* middle ridge with the Mount Nittany knob */}
      <g className="lp-par" style={{ '--px': 8, '--py': 2.5 }}>
        <path {...r(0.25)} d="M0 178 C 110 164, 210 132, 320 128 C 430 124, 500 140, 580 152 C 700 168, 800 172, 900 166 C 1000 160, 1080 122, 1180 114 C 1260 108, 1360 124, 1460 136 C 1520 142, 1570 146, 1600 148 V300 H0 Z" fill="#7FAE86" />
      </g>
      {/* near hills */}
      <g className="lp-par" style={{ '--px': 13, '--py': 3 }}>
        <path {...r(0.4)} d="M0 228 C 140 214, 260 202, 380 206 C 500 210, 560 226, 680 230 C 800 234, 900 222, 1020 214 C 1160 204, 1300 208, 1440 218 C 1520 224, 1570 226, 1600 226 V300 H0 Z" fill="#4F8A55" />
      </g>
      {/* meadow, water, forest, earth */}
      <g className="lp-par" style={{ '--px': 18, '--py': 4 }}>
        <g {...r(0.55)}>
          <path d="M0 262 C 200 252, 420 256, 640 262 C 860 268, 1100 256, 1340 254 C 1460 253, 1550 256, 1600 258 V300 H0 Z" fill="#79A35A" />
          <path d={STREAM} fill="none" stroke="#8FCBEA" strokeWidth="3.2" strokeLinecap="round" />
          <path className="lp-flow lp-flow-slow" d={STREAM} fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <path d={RIVER} fill="#8FCBEA" />
          <path d={RIVER} fill="none" stroke="#C7E7F7" strokeWidth="1.2" />
          <path className="lp-flow" d={RIVER_FLOW} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          <path className="lp-flow lp-flow-b" d={RIVER_FLOW} fill="none" stroke="#fff" strokeWidth="1" strokeLinecap="round" transform="translate(10 0)" />
          {TREES.map(([x, h, kind, color], i) => <Tree key={i} i={i} x={x} h={h} kind={kind} color={color} />)}
          <path d="M0 290 C 400 284, 900 292, 1600 286 V300 H0 Z" fill="#6E5034" />
        </g>
      </g>
    </svg>
  )
}
