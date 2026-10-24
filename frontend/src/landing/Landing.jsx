import { useEffect, useRef } from 'react'
import { Clouds, Ridges } from './SkyScene'
import { RotatingBadge, Wordmark } from './Logo'
import TrailTicker from './TrailTicker'
import './landing.css'

const FEATURES = [
  { title: 'Five levels', text: 'Each rating explains itself.' },
  { title: 'Car-free', text: 'Bus, walk or bike from campus.' },
  { title: 'Safety notes', text: 'Weather, sunset, hunting season.' },
  { title: 'Reviews', text: 'From Penn State hikers.' },
]

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-psu-navy'

// Writes the pointer position as --mx/--my (-1..1) on the root; .lp-par layers read it.
function useParallax() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return } catch { /* old browsers */ }
    let raf = 0
    let x = 0
    let y = 0
    const onMove = e => {
      x = (e.clientX / window.innerWidth) * 2 - 1
      y = (e.clientY / window.innerHeight) * 2 - 1
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        el.style.setProperty('--mx', x.toFixed(3))
        el.style.setProperty('--my', y.toFixed(3))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf) }
  }, [])
  return ref
}

// signedInName: set when someone already signed in came back here with the browser Back button.
// guestReturning: a guest came back here; the guest link then reads "Keep browsing".
export default function Landing({
  onSignIn, onSignUp, onGuest, onContinue, onSignOut,
  signedInName = null, guestReturning = false, busy = false, error = null,
}) {
  const root = useParallax()
  const signedIn = Boolean(signedInName)

  return (
    // Below 960px the app shell locks html/body scrolling (index.css), so the sign-in page scrolls itself there.
    <div ref={root} className="lp-scroll lp-sky relative isolate min-h-screen overflow-hidden font-landing text-psu-navy antialiased">
      <Clouds />
      <Ridges className="pointer-events-none absolute bottom-0 left-[-4%] h-[30vh] min-h-[190px] w-[108%]" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 pt-6 sm:px-10 lg:px-16 lg:pt-8">
          <Wordmark />
          <p className="hidden text-right text-xs leading-relaxed tabular-nums text-psu-slate lg:block">
            State College, Pennsylvania
            <br />
            40.79° N, 77.86° W
          </p>
          <button
            onClick={signedIn ? onContinue : onSignIn}
            disabled={busy}
            className={`rounded-full bg-psu-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-70 lg:hidden ${focusRing}`}
          >
            {signedIn ? 'Continue' : 'Sign in'}
          </button>
        </header>

        {/* bottom padding keeps text above the dark near ridges; the sign-in card may float over the far ones */}
        <main className="grid flex-1 items-center gap-14 px-6 pb-[200px] pt-12 sm:px-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16 lg:px-16 lg:pb-[17vh] lg:pt-4 [@media(min-width:1024px)_and_(max-height:820px)]:pb-[9vh] [@media(min-width:1024px)_and_(max-height:820px)]:pt-2 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* ---------- left: what HikingPSU is ---------- */}
          <div>
            <h1
              className="lp-fade font-light leading-[0.9] tracking-[-0.045em] text-[clamp(3.6rem,min(8.4vw,14vh),8.5rem)]"
              style={{ '--d': '0.05s' }}
            >
              Hike Happy
              <br />
              Valley.
            </h1>
            <p className="lp-fade mt-7 max-w-[42ch] text-lg leading-relaxed text-psu-slate xl:text-xl" style={{ '--d': '0.2s' }}>
              Trails around State College, rated for real people. Tell us your time, your group and whether
              you have a car, and we’ll find the right hike.
            </p>
            <ul className="lp-fade mt-10 [@media(min-width:1024px)_and_(max-height:820px)]:mt-7 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-5 xl:grid-cols-4" style={{ '--d': '0.35s' }}>
              {FEATURES.map(f => (
                <li key={f.title} className="border-t border-psu-navy/20 pt-3">
                  <h2 className="text-sm font-semibold">{f.title}</h2>
                  <p className="mt-0.5 text-sm text-psu-slate">{f.text}</p>
                </li>
              ))}
            </ul>
            {/* live trail card; dropped on short laptop screens so the headline and sign-in stay in view */}
            <TrailTicker className="mt-10 sm:w-96 [@media(min-width:1024px)_and_(max-height:820px)]:hidden" />
          </div>

          {/* ---------- right: sign in ---------- */}
          <div className="lp-fade mx-auto w-full max-w-[420px] lg:mx-0" style={{ '--d': '0.3s' }}>
            <section
              id="sign-in"
              aria-labelledby="sign-in-title"
              className="relative rounded-[28px] bg-white/95 p-8 shadow-[0_40px_90px_-40px_rgba(0,30,68,0.55)] ring-1 ring-white sm:p-10 [@media(min-width:1024px)_and_(max-height:820px)]:p-8"
            >
              <RotatingBadge className="absolute -right-5 -top-10 h-24 w-24 sm:-right-10 sm:-top-12 sm:h-28 sm:w-28" />
              <h2 id="sign-in-title" className="pr-16 text-[1.9rem] font-normal leading-tight tracking-[-0.02em]">
                {signedIn ? 'Welcome back' : 'Plan your next hike'}
              </h2>
              <p className="mt-3 leading-relaxed text-psu-slate">
                {signedIn
                  ? <>You’re signed in as <span className="font-medium text-psu-navy">{signedInName}</span>. Your saved trails and conversations are waiting.</>
                  : 'Sign in to save trails, keep your trip conversations and review the hikes you’ve done.'}
              </p>

              <button
                onClick={signedIn ? onContinue : onSignIn}
                disabled={busy}
                className={`lp-shine mt-8 [@media(min-width:1024px)_and_(max-height:820px)]:mt-6 h-[52px] w-full rounded-2xl bg-psu-navy font-medium text-white transition-colors hover:bg-psu-beaver disabled:cursor-wait disabled:bg-psu-beaver/80 ${focusRing}`}
              >
                {signedIn ? 'Continue to HikingPSU' : busy ? 'Continue in the pop-up window' : 'Sign in'}
              </button>
              <button
                onClick={signedIn ? onSignOut : onSignUp}
                disabled={busy}
                className={`mt-3 h-[52px] w-full rounded-2xl border border-psu-navy/15 font-medium text-psu-navy transition-colors hover:border-psu-navy/40 hover:bg-psu-mist disabled:opacity-60 ${focusRing}`}
              >
                {signedIn ? 'Sign out' : 'Create an account'}
              </button>

              {error && !signedIn && (
                <p role="alert" className="mt-5 rounded-xl bg-psu-mist px-4 py-3 text-sm leading-relaxed text-psu-navy">
                  {error}
                </p>
              )}

              {onGuest && !signedIn && (
                <p className="mt-6 text-sm text-psu-slate">
                  {guestReturning ? 'Not ready to sign in?' : 'Just looking?'}{' '}
                  <button onClick={onGuest} disabled={busy} className={`font-medium text-psu-beaver underline underline-offset-4 hover:text-psu-navy ${focusRing}`}>
                    {guestReturning ? 'Keep browsing without an account' : 'Browse trails without an account'}
                  </button>
                </p>
              )}

              <p className="mt-7 [@media(min-width:1024px)_and_(max-height:820px)]:mt-5 border-t border-psu-navy/10 pt-5 text-xs leading-relaxed text-psu-slate/90">
                Sign-in is handled by Auth0 in a secure pop-up. HikingPSU never sees your password.
                A Penn State student project, not an official university service.
              </p>
            </section>
          </div>
        </main>

      </div>
    </div>
  )
}
