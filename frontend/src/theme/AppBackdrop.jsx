import { Clouds } from '../landing/SkyScene'
import '../landing/landing.css'
import './theme.css'

// Scenery behind the app: Penn State sky, drifting clouds, Central PA ridges and a strip of
// conifer forest. Light, airy tones so text over it stays readable. Purely decorative and fixed
// behind every panel, so no widget changes size or behaviour. (The walking hiker lives on the
// header line, see HeaderTrail.jsx, where nothing covers him.)

// Deterministic forest: [x, height] pairs spread along the foreground.
const TREES = Array.from({ length: 58 }, (_, i) => {
  const x = -20 + i * 29 + ((i * 37) % 13)
  const h = 22 + ((i * 53) % 19)
  return [x, h]
}).filter(([x]) => !(x > 520 && x < 760)) // a clearing in the middle keeps it from reading as a wall

export default function AppBackdrop() {
  return (
    <div className="hp-backdrop" aria-hidden="true">
      <div className="hp-backdrop-clouds"><Clouds /></div>
      <svg className="hp-backdrop-land" viewBox="0 0 1600 240" preserveAspectRatio="xMidYMax slice">
        <path d="M-40 118 C 120 100, 220 70, 340 66 L 760 60 C 840 60, 880 96, 960 104 C 1060 112, 1140 80, 1240 74 L 1640 68 V240 H-40 Z" fill="#E1EBF6" />
        <path d="M-40 168 C 120 156, 250 124, 380 120 C 500 116, 560 130, 640 142 C 760 160, 860 164, 980 158 C 1100 152, 1180 118, 1300 112 C 1420 106, 1540 120, 1640 128 V240 H-40 Z" fill="#C9DBEE" />
        <path d="M-40 212 C 220 200, 520 204, 800 210 C 1080 216, 1340 202, 1640 198 V240 H-40 Z" fill="#AFC7E3" />
        <g>
          {TREES.map(([x, h], i) => (
            <path
              key={i}
              className="hp-tree"
              style={{ '--sway-delay': `${-(i % 7) * 0.7}s`, '--sway-dur': `${5 + (i % 5)}s` }}
              d={`M${x} ${214 - h} L${x + h * 0.32} ${212} L${x - h * 0.32} ${212} Z`}
              fill={i % 3 === 0 ? '#8DACD5' : '#7898C6'}
            />
          ))}
        </g>
        <path d="M-40 232 C 400 229, 900 233, 1640 230 V240 H-40 Z" fill="#1E407C" />
      </svg>
    </div>
  )
}
