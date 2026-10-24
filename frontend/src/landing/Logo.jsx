import { useId } from 'react'
import '@fontsource-variable/hanken-grotesk/index.css'

// HikingPSU mark: a round trail badge in Nittany Navy. Inside, the Mount Nittany knob
// (Pugh Blue) over a white valley, a switchback trail climbing to a flag on the summit.
export function Mark({ className = 'h-9 w-9', title }) {
  const clip = useId()
  return (
    <svg viewBox="0 0 48 48" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={clip}>
          <circle cx="24" cy="24" r="21" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="24" fill="#001E44" />
      <circle cx="24" cy="24" r="21.6" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.8" />
      <g clipPath={`url(#${clip})`}>
        <path d="M0 32 C 7 28, 11 20, 18 19 C 24 18, 27 23, 31 26 C 35 29, 41 28, 48 27 V48 H0 Z" fill="#96BEE6" />
        <path d="M0 36.5 C 10 33.5, 18 32.5, 26 34 C 34 35.5, 40 33.5, 48 32.5 V48 H0 Z" fill="#fff" />
        <path
          d="M23 45 L28 39.5 L21.5 35.5 L25 29.5 L19.5 25.5 L18 20.5"
          fill="none" stroke="#001E44" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0.01 2.6"
        />
      </g>
      {/* summit flag */}
      <path d="M18 19.5 V11.5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M18.4 11.6 L24 13.4 L18.4 15.4 Z" fill="#fff" />
    </svg>
  )
}

// Lockup: mark + "Hiking" (light) "PSU" (heavy). The weight change is the brand: the walk and the school.
export function Wordmark({ className = '', markClassName = 'h-9 w-9', textClassName = 'text-[1.35rem]', tone = 'navy' }) {
  const color = tone === 'white' ? 'text-white' : 'text-psu-navy'
  return (
    <span className={`inline-flex items-center gap-2.5 font-landing ${color} ${className}`}>
      <Mark className={markClassName} />
      <span className={`leading-none tracking-[-0.02em] ${textClassName}`}>
        <span className="font-light">Hiking</span>
        <span className="font-extrabold tracking-[0.01em]">PSU</span>
      </span>
    </span>
  )
}

// Large badge with ring text that turns slowly. Decorative; the page names itself elsewhere.
export function RotatingBadge({ className = '' }) {
  const ring = useId()
  return (
    // outer div takes the caller's positioning (e.g. `absolute`); the inner one anchors the centre mark
    <div className={className} aria-hidden="true">
      <div className="relative h-full w-full">
      <svg viewBox="0 0 140 140" className="h-full w-full drop-shadow-[0_10px_24px_rgba(0,30,68,0.28)]">
        <defs>
          <path id={ring} d="M70 70 m-53 0 a53 53 0 1 1 106 0 a53 53 0 1 1 -106 0" />
        </defs>
        <circle cx="70" cy="70" r="70" fill="#001E44" />
        <circle cx="70" cy="70" r="64" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="0.75" />
        <circle cx="70" cy="70" r="42" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="0.75" />
        <g className="lp-spin">
          <text fill="#fff" fontSize="9.6" fontWeight="600" letterSpacing="2.4" style={{ fontFamily: '"Hanken Grotesk Variable", sans-serif' }}>
            <textPath href={`#${ring}`} textLength="330" lengthAdjust="spacing">
              HIKING PSU • HAPPY VALLEY TRAILS • STATE COLLEGE PA •
            </textPath>
          </text>
        </g>
      </svg>
      <Mark className="absolute left-1/2 top-1/2 h-[52%] w-[52%] -translate-x-1/2 -translate-y-1/2" />
      </div>
    </div>
  )
}
