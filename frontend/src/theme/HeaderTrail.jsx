import './theme.css'

// The header's bottom line becomes a trail: a few small pines along it, and a hiker with a
// backpack and trekking pole walking left to right, then setting out again from the left.
// Decorative only (aria-hidden, no pointer events); still when reduced motion is on.

const PINES = [[7, 11], [8.6, 15], [10, 9], [31, 13], [32.4, 9], [56, 16], [57.6, 11], [59, 13], [83, 12], [84.5, 16], [96, 10]]

function Hiker() {
  // feet at the bottom edge of a 16×22 box, facing right
  return (
    <svg viewBox="-7 -20 16 21" className="hp-trail-hiker-body" aria-hidden="true">
      <g fill="#001E44" stroke="#001E44" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="1.5" cy="-17" r="2.4" stroke="none" />
        <rect x="-4.6" y="-14.5" width="4" height="6.5" rx="1.2" stroke="none" />
        <path d="M0.8 -14 L1.6 -6.5" strokeWidth="2.6" fill="none" />
        <path className="hp-leg" d="M1.6 -6.5 L0.2 0" strokeWidth="1.8" fill="none" />
        <path className="hp-leg hp-leg-b" d="M1.6 -6.5 L3.4 0" strokeWidth="1.8" fill="none" />
        <path className="hp-pole" d="M3 -11 L6.6 0.5" strokeWidth="0.9" fill="none" />
      </g>
    </svg>
  )
}

export default function HeaderTrail() {
  return (
    <div className="hp-trail" aria-hidden="true">
      {PINES.map(([left, h], i) => (
        <svg key={i} className="hp-trail-pine" style={{ left: `${left}%`, height: h, width: h * 0.7 }} viewBox="0 0 7 10" preserveAspectRatio="none">
          <path d="M3.5 0 L7 10 L0 10 Z" fill={i % 2 ? '#96BEE6' : '#1E407C'} />
        </svg>
      ))}
      <div className="hp-trail-walker"><Hiker /></div>
    </div>
  )
}
