import { useRef } from 'react'
import Medal from './Medal'

// The medal case on the profile page: the medal you are proudest of, the next one within reach,
// then the trail ladder and the medals for exploring, all with progress.

const LADDER = ['trailhead', 'valley-walker', 'ridge-walker', 'summit', 'seven-mountains', 'allegheny-front']
const SIDE = ['explorer', 'car-free', 'four-seasons', 'trail-guide']

const fmt = d => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

// a gentle 3D tilt toward the pointer
function useTilt() {
  const ref = useRef(null)
  const move = e => {
    const el = ref.current
    if (!el || e.pointerType === 'touch') return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `perspective(700px) rotateY(${(x * 22).toFixed(1)}deg) rotateX(${(-y * 18).toFixed(1)}deg) translateZ(6px)`
  }
  const leave = () => { if (ref.current) ref.current.style.transform = '' }
  return { ref, onPointerMove: move, onPointerLeave: leave }
}

function Tile({ b }) {
  const tilt = useTilt()
  const pct = Math.round((b.progress / b.goal) * 100)
  return (
    <li className={`mw-tile ${b.earned ? 'is-earned' : ''} ${b.rank >= 80 ? 'is-honour' : ''}`}>
      <div className="mw-medal" {...tilt}><Medal id={b.id} earned={b.earned} size={96} title={b.name} /></div>
      <h3>{b.name}</h3>
      <p>{b.earned ? b.tagline : b.how}</p>
      {b.earned
        ? <span className="mw-date">{b.earned_on ? `Earned ${fmt(b.earned_on)}` : 'Earned'}</span>
        : <span className="mw-progress" aria-label={`${b.progress} of ${b.goal}`}><span style={{ '--w': `${pct}%` }} /><b>{b.progress}/{b.goal}</b></span>}
    </li>
  )
}

export default function MedalWall({ data }) {
  const heroTilt = useTilt()
  if (!data) return null
  const by = Object.fromEntries(data.badges.map(b => [b.id, b]))
  const top = data.top ? by[data.top] : null
  // the next medal: the locked one closest to done, ladder first on a tie
  const next = data.badges.filter(b => !b.earned)
    .sort((a, b) => b.progress / b.goal - a.progress / a.goal || LADDER.indexOf(b.id) - LADDER.indexOf(a.id) || a.rank - b.rank)[0]
  return (
    <section className="mw" aria-labelledby="mw-title">
      <div className="mw-head">
        <div>
          <span className="eyebrow">TRAIL MEDALS</span>
          <h2 id="mw-title">Your medal case</h2>
        </div>
        <span className="mw-count"><b>{data.earned}</b> of {data.badges.length} earned</span>
      </div>

      <div className="mw-hero">
        <div className="mw-feature">
          <div className="mw-medal mw-medal-lg" {...heroTilt}><Medal id={top ? top.id : 'trailhead'} earned={!!top} size={150} title={top ? top.name : 'Trailhead'} /></div>
          <div>
            <span className="mw-label">{top ? 'Highest medal' : 'Your first medal'}</span>
            <h3>{top ? top.name : 'Trailhead'}</h3>
            <p>{top ? top.tagline : 'Finish any trail and tap “I finished this trail” to earn it.'}</p>
            {top?.earned_on && <span className="mw-date">Earned {fmt(top.earned_on)}</span>}
          </div>
        </div>
        {next && (
          <div className="mw-next">
            <span className="mw-label">Next up</span>
            <div className="mw-next-row">
              <Medal id={next.id} earned={false} size={64} title={next.name} />
              <div>
                <h3>{next.name}</h3>
                <p>{next.how}</p>
                <span className="mw-progress"><span style={{ '--w': `${Math.round((next.progress / next.goal) * 100)}%` }} /><b>{next.progress}/{next.goal}</b></span>
              </div>
            </div>
          </div>
        )}
      </div>

      <h3 className="mw-group">The trail ladder</h3>
      <ol className="mw-grid">{LADDER.map(id => by[id] && <Tile key={id} b={by[id]} />)}</ol>
      <h3 className="mw-group">Along the way</h3>
      <ul className="mw-grid mw-grid-side">{SIDE.map(id => by[id] && <Tile key={id} b={by[id]} />)}</ul>
      <p className="mw-note">Each trail counts once. Honour medals count hard trails you have also reviewed. Hike safe: check the weather and sunset before every climb.</p>
    </section>
  )
}
