import { useEffect, useRef } from 'react'
import Medal from './Medal'

// The moment a medal is earned: the medal rises out of a burst of light, with a little confetti.
const CONFETTI = Array.from({ length: 26 }, (_, i) => ({
  x: (i * 37) % 100, d: (i % 7) * 0.12, r: (i * 53) % 360, c: ['#f5c04a', '#2f6b47', '#2c7fbf', '#d2873c', '#ffffff'][i % 5],
}))

export default function MedalUnlocked({ medal, more = 0, onClose, onSeeAll }) {
  const button = useRef(null)
  useEffect(() => {
    button.current?.focus()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [medal.id, onClose])
  const honour = medal.rank >= 60
  return (
    <div className="mu-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="mu-title" className={`mu-card ${honour ? 'mu-honour' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="mu-stage" aria-hidden="true">
          <div className="mu-glow" />
          <div className="mu-rays" />
          {CONFETTI.map((p, i) => <span key={i} className="mu-confetti" style={{ left: `${p.x}%`, animationDelay: `${p.d}s`, background: p.c, '--r': `${p.r}deg` }} />)}
          <div className="mu-medal"><Medal id={medal.id} size={176} title={medal.name} /></div>
        </div>
        <p className="mu-eyebrow">{honour ? 'Honour medal unlocked' : 'Medal unlocked'}</p>
        <h2 id="mu-title">{medal.name}</h2>
        <p className="mu-tagline">{medal.tagline}</p>
        <div className="mu-actions">
          <button ref={button} className="primary-button" onClick={onClose}>{more ? `Next medal (${more} more)` : 'Keep hiking'}</button>
          {onSeeAll && <button className="text-button" onClick={onSeeAll}>See all medals</button>}
        </div>
      </div>
    </div>
  )
}
