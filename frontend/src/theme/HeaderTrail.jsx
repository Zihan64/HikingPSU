import { Hiker } from '../scene/Wildlife'
import '../scene/scene.css'
import './theme.css'

// The header's bottom line becomes a trail: small spruces and autumn maples stand along it, and a
// fully equipped hiker (hat, big pack with sleeping-pad roll, trekking poles, boots) walks left to
// right, then sets out again from the left. Decorative only; still when reduced motion is on.

// [left %, height px, kind]
const TREES = [[6.5, 22, 'spruce'], [7.8, 28, 'spruce'], [9.2, 18, 'maple'], [30.5, 24, 'spruce'], [31.8, 17, 'spruce'],
  [55.5, 29, 'spruce'], [57, 20, 'maple'], [58.3, 23, 'spruce'], [82.5, 21, 'spruce'], [84, 30, 'spruce'], [95.5, 19, 'maple']]
// Keep the complete artwork inside the header's 20px bottom padding.
const SCALE = 20 / 32

function Spruce() {
  return (
    <svg viewBox="0 0 20 40" className="h-full w-full">
      <rect x="9" y="33" width="2" height="7" fill="#5a3d26" />
      <path fill="#1d3626" d="M10 0 L11.2 4 L13 5 L11.6 6 L14.4 9.5 L12.4 10 L16 14.5 L13.2 15 L17.6 20.5 L14 21 L19 27.5 L14.6 28 L20 34 L0 34 L5.4 28 L1 27.5 L6 21 L2.4 20.5 L6.8 15 L4 14.5 L7.6 10 L5.6 9.5 L8.4 6 L7 5 L8.8 4 Z" />
      <path fill="none" stroke="rgba(255,214,140,0.55)" strokeWidth="0.6" d="M11.2 4 L13 5 M14.4 9.5 L12.4 10 M16 14.5 M17.6 20.5 L14 21 M19 27.5 L14.6 28 M20 34" />
    </svg>
  )
}

function Maple() {
  return (
    <svg viewBox="0 0 24 34" className="h-full w-full">
      <path d="M11 33 L 11.6 20 L 9 15 M 12 22 L 15 16" stroke="#5a3d26" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path fill="#b8612a" d="M12 2 C 16 1, 19 4, 19 7 C 23 8, 24 13, 21 16 C 23 19, 20 23, 16 22 C 14 25, 9 25, 7.6 22 C 3.6 23, 0.6 19, 2.6 16 C -0.4 12.6, 2 8, 5.6 8 C 5.6 4, 8.4 2, 12 2 Z" />
      <path fill="#d98a3a" d="M13 4 C 16 4, 17.6 6, 17.6 8.4 C 20.4 9.6, 21 12.6, 19 14.6 C 17 13, 14 13, 12.6 10.6 C 11.6 8, 11.4 5.6, 13 4 Z" />
    </svg>
  )
}

export default function HeaderTrail() {
  return (
    <div className="hp-trail" aria-hidden="true">
      {TREES.map(([left, h, kind], i) => (
        <div key={i} className="hp-trail-tree" style={{ left: `${left}%`, height: h * SCALE, width: (kind === 'spruce' ? h * 0.5 : h * 0.7) * SCALE, animationDelay: `${-i * 0.7}s` }}>
          {kind === 'spruce' ? <Spruce /> : <Maple />}
        </div>
      ))}
      <div className="hp-trail-walker"><Hiker className="h-full w-full" /></div>
    </div>
  )
}
