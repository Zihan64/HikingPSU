// Sky, drifting clouds and Central PA ridges for the sign-in page.
// The ridges are long and flat-topped like Tussey Mountain, with the rounded Mount Nittany
// knob in the middle layer: the ridge-and-valley skyline you see from campus.
// Every layer sits in a .lp-par group so the pointer parallax gives it depth (near moves most).

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
  { top: 17, width: 120, dur: 170, delay: -40, opacity: 0.7, depth: 10 },
  { top: 30, width: 320, dur: 110, delay: -20, opacity: 0.85, depth: 28 },
  { top: 44, width: 160, dur: 150, delay: -120, opacity: 0.65, depth: 14 },
  { top: 55, width: 100, dur: 190, delay: -70, opacity: 0.55, depth: 8 },
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

const RIDGES = [
  { fill: '#C4D9EF', px: 4, py: 1.5, d: 'M0 150 C 50 132, 100 104, 160 98 L 520 90 C 580 90, 620 124, 690 134 C 760 142, 820 112, 880 104 L 1000 100 L 1000 300 L 0 300 Z' },
  { fill: '#86A8D2', px: 8, py: 2.5, d: 'M0 206 C 80 192, 140 156, 220 150 C 300 146, 340 150, 400 164 C 470 182, 520 190, 600 186 C 680 182, 720 140, 800 132 C 860 128, 920 140, 1000 150 L 1000 300 L 0 300 Z' },
  { fill: '#1E407C', px: 13, py: 3, d: 'M0 246 C 120 240, 200 226, 300 228 C 420 230, 480 252, 600 248 C 720 244, 800 220, 900 216 C 950 214, 980 218, 1000 220 L 1000 300 L 0 300 Z' },
  { fill: '#001E44', px: 20, py: 4, d: 'M0 284 C 160 274, 360 276, 520 284 C 680 292, 840 280, 1000 274 L 1000 300 L 0 300 Z' },
]

export function Ridges({ className = '' }) {
  return (
    <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className={className} aria-hidden="true">
      {RIDGES.map((r, i) => (
        <g key={i} className="lp-par" style={{ '--px': r.px, '--py': r.py }}>
          <path d={r.d} fill={r.fill} className="lp-rise" style={{ '--d': `${0.1 + i * 0.16}s` }} />
        </g>
      ))}
    </svg>
  )
}
