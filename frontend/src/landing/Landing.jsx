import { useEffect, useRef } from 'react'
import { RotatingBadge, Wordmark } from './Logo'
import TrailTicker from './TrailTicker'
import { HeroScenery } from '../scenery/Scenery'
import './landing.css'

const FEATURES = [
  { title: 'Five levels', text: 'Each rating explains itself.' },
  { title: 'Car-free', text: 'Bus, walk or bike from campus.' },
  { title: 'Safety notes', text: 'Weather, sunset, hunting season.' },
  { title: 'Reviews', text: 'From Penn State hikers.' },
]

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trail-forest'

// Land height: about a third of the first screen, never tiny, never overwhelming.
const landHeight = () => Math.min(460, Math.max(280, window.innerHeight * 0.42))

// signedInName: set when someone already signed in came back here with the browser Back button.
// guestReturning: a guest came back here; the guest link then reads "Keep browsing".
export default function Landing({
  onSignIn, onSignUp, onGuest, onContinue, onSignOut,
  signedInName = null, guestReturning = false, busy = false, error = null,
}) {
  const sceneBox = useRef(null)
  const signedIn = Boolean(signedInName)

  // The land height is shared with the scenery through --land.
  useEffect(() => {
    const set = () => sceneBox.current?.style.setProperty('--land', `${landHeight()}px`)
    set()
    window.addEventListener('resize', set)
    return () => window.removeEventListener('resize', set)
  }, [])

  return (
    // Below 960px the app shell locks html/body scrolling (index.css), so the sign-in page scrolls itself there.
    // The outer div only scrolls; the inner one is as tall as the content and holds the scene, so on phones
    // the sky stays at the top and the land sits at the very bottom.
    <div className="lp-scroll font-landing text-trail-ink antialiased">
    <div ref={sceneBox} className="lp-sky relative isolate min-h-full overflow-hidden">
      <HeroScenery className="absolute inset-0" />
      {/* a soft shade behind the white text keeps it legible against bright cloud */}
      <div className="lp-shade pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 pt-6 sm:px-10 lg:px-16 lg:pt-8">
          <Wordmark tone="white" className="lp-on-scene" />
          <p className="lp-on-scene hidden text-right text-xs leading-relaxed tabular-nums text-white/85 lg:block">
            State College, Pennsylvania
            <br />
            40.79° N, 77.86° W
          </p>
          <button
            onClick={signedIn ? onContinue : onSignIn}
            disabled={busy}
            className={`rounded-full bg-trail-forest px-4 py-2 text-sm font-medium text-white shadow-lg disabled:opacity-70 lg:hidden ${focusRing}`}
          >
            {signedIn ? 'Continue' : 'Sign in'}
          </button>
        </header>

        {/* bottom padding keeps text above the dark near ridges; the sign-in card may float over the far ones */}
        <main className="grid flex-1 items-center gap-14 px-6 pb-[200px] pt-12 sm:px-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16 lg:px-16 lg:pb-[17vh] lg:pt-4 [@media(min-width:1024px)_and_(max-height:820px)]:pb-[9vh] [@media(min-width:1024px)_and_(max-height:820px)]:pt-2 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* ---------- left: what HikingPSU is ---------- */}
          <div>
            <h1
              className="lp-fade lp-on-scene font-light leading-[0.9] tracking-[-0.045em] text-white text-[clamp(3.6rem,min(8.4vw,14vh),8.5rem)]"
              style={{ '--d': '0.05s' }}
            >
              Hike Happy
              <br />
              Valley.
            </h1>
            <p className="lp-fade lp-on-scene mt-7 max-w-[42ch] text-lg leading-relaxed text-white/90 xl:text-xl" style={{ '--d': '0.2s' }}>
              Trails around State College, rated for real people. Tell us your time, your group and whether
              you have a car, and we’ll find the right hike.
            </p>
            <ul className="lp-fade lp-on-scene mt-10 [@media(min-width:1024px)_and_(max-height:820px)]:mt-7 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-5 xl:grid-cols-4" style={{ '--d': '0.35s' }}>
              {FEATURES.map(f => (
                <li key={f.title} className="border-t border-white/35 pt-3">
                  <h2 className="text-sm font-semibold text-white">{f.title}</h2>
                  <p className="mt-0.5 text-sm text-white/80">{f.text}</p>
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
              className="relative rounded-[28px] bg-white/95 p-8 shadow-[0_40px_90px_-40px_rgba(23,58,64,0.55)] ring-1 ring-white sm:p-10 [@media(min-width:1024px)_and_(max-height:820px)]:p-8"
            >
              <RotatingBadge className="absolute -right-5 -top-10 h-24 w-24 sm:-right-10 sm:-top-12 sm:h-28 sm:w-28" />
              <h2 id="sign-in-title" className="pr-16 text-[1.9rem] font-normal leading-tight tracking-[-0.02em]">
                {signedIn ? 'Welcome back' : 'Plan your next hike'}
              </h2>
              <p className="mt-3 leading-relaxed text-trail-slate">
                {signedIn
                  ? <>You’re signed in as <span className="font-medium text-trail-ink">{signedInName}</span>. Your saved trails and conversations are waiting.</>
                  : 'Sign in to save trails, keep your trip conversations and review the hikes you’ve done.'}
              </p>

              <button
                onClick={signedIn ? onContinue : onSignIn}
                disabled={busy}
                className={`lp-shine mt-8 [@media(min-width:1024px)_and_(max-height:820px)]:mt-6 h-[52px] w-full rounded-2xl bg-trail-forest font-medium text-white transition-colors hover:bg-trail-leaf disabled:cursor-wait disabled:bg-trail-leaf/80 ${focusRing}`}
              >
                {signedIn ? 'Continue to HikingPSU' : busy ? 'Continue in the pop-up window' : 'Sign in'}
              </button>
              <button
                onClick={signedIn ? onSignOut : onSignUp}
                disabled={busy}
                className={`mt-3 h-[52px] w-full rounded-2xl border border-trail-ink/15 font-medium text-trail-ink transition-colors hover:border-trail-ink/40 hover:bg-trail-sage disabled:opacity-60 ${focusRing}`}
              >
                {signedIn ? 'Sign out' : 'Create an account'}
              </button>

              {error && !signedIn && (
                <p role="alert" className="mt-5 rounded-xl bg-trail-sage px-4 py-3 text-sm leading-relaxed text-trail-ink">
                  {error}
                </p>
              )}

              {onGuest && !signedIn && (
                <p className="mt-6 text-sm text-trail-slate">
                  {guestReturning ? 'Not ready to sign in?' : 'Just looking?'}{' '}
                  <button onClick={onGuest} disabled={busy} className={`font-medium text-trail-sky underline underline-offset-4 hover:text-trail-ink ${focusRing}`}>
                    {guestReturning ? 'Keep browsing without an account' : 'Browse trails without an account'}
                  </button>
                </p>
              )}

              <p className="mt-7 [@media(min-width:1024px)_and_(max-height:820px)]:mt-5 border-t border-trail-ink/10 pt-5 text-xs leading-relaxed text-trail-slate/90">
                Sign-in is handled by Auth0 in a secure pop-up. HikingPSU never sees your password.
                A Penn State student project, not an official university service.
              </p>
            </section>
          </div>
        </main>

      </div>
    </div>
    </div>
  )
}
