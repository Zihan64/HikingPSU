import './theme.css'

// The header's bottom line becomes a trail: small pines (and one autumn tree) on brown trunks
// along it, and a hiker with an orange backpack and trekking pole walking left to right, then
// setting out again from the left. Decorative only (aria-hidden, no pointer events);
// still when reduced motion is on.

// [left %, height px, kind]
const TREES = [[7, 14, 'pine'], [8.6, 18, 'pine'], [10, 12, 'leaf'], [31, 15, 'pine'], [32.4, 11, 'pine'],
  [56, 19, 'pine'], [57.6, 13, 'leaf'], [59, 15, 'pine'], [83, 14, 'pine'], [84.5, 19, 'pine'], [96, 12, 'leaf']]

function Hiker() {
  // feet at the bottom edge, facing right
  return (
    <svg viewBox="-7 -20 16 21" className="hp-trail-hiker-body" aria-hidden="true">
      <g stroke="#173A40" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="1.5" cy="-17" r="2.4" fill="#173A40" stroke="none" />
        <rect x="-4.8" y="-14.5" width="4.2" height="6.8" rx="1.3" fill="#D2873C" stroke="none" />
        <path d="M0.8 -14 L1.6 -6.5" strokeWidth="2.6" fill="none" />
        <path className="hp-leg" d="M1.6 -6.5 L0.2 0" strokeWidth="1.8" fill="none" />
        <path className="hp-leg hp-leg-b" d="M1.6 -6.5 L3.4 0" strokeWidth="1.8" fill="none" />
        <path className="hp-pole" d="M3 -11 L6.6 0.5" stroke="#7A5434" strokeWidth="0.9" fill="none" />
      </g>
    </svg>
  )
}

export default function HeaderTrail() {
  return (
    <div className="hp-trail" aria-hidden="true">
      {TREES.map(([left, h, kind], i) => (
        <svg key={i} className="hp-trail-pine" style={{ left: `${left}%`, height: h, width: h * 0.72 }} viewBox="0 0 10 14">
          <rect x="4.2" y="10" width="1.6" height="4" fill="#7A5434" />
          {kind === 'pine'
            ? <path d="M5 0 L9.4 10.5 L0.6 10.5 Z" fill={i % 2 ? '#3E8558' : '#2F6B47'} />
            : <circle cx="5" cy="6.4" r="4.4" fill="#D2873C" />}
        </svg>
      ))}
      <div className="hp-trail-walker"><Hiker /></div>
    </div>
  )
}
