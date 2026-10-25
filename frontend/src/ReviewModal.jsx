import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { deleteReview, finishCheckin, getTrailReviews, saveReview } from './api'
import { AUTH_ENABLED, useOptionalToken } from './auth'
import { StarInput } from './Stars'
import { TIER_EMOJI, TIER_LABEL, checkinTiming, formatClock } from './checkin'
import useNow from './useNow'

const QUESTIONS = [
  { key: 'accuracy', label: 'How accurate was our info?', hint: 'Distance, difficulty, access, conditions as we described them' },
  { key: 'difficulty', label: 'How difficult was the trail?', hint: '1 = very easy, 5 = very hard' },
  { key: 'enjoyment', label: 'How much did you enjoy it?', hint: 'Overall enjoyment and views' },
]

// Login happens on Auth0's page; we never see the password.
function SignIn() {
  const { loginWithRedirect } = useAuth0()
  if (!AUTH_ENABLED) {
    return <p className="text-sm text-stone-600">Reviews need an account, and login isn't set up on this server yet.</p>
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">Log in so your review is tied to your account (you can edit or delete it later).</p>
      <button onClick={() => loginWithRedirect()} className="w-full rounded-lg bg-trail-forest px-4 py-2 text-sm font-semibold text-white">
        Log in or sign up
      </button>
    </div>
  )
}

// checkin: finish mode. Submitting completes the hike (review + hike log + badges) instead of saving a review.
function ReviewForm({ trail, existing, checkin, getToken, onSaved, onAuthLost, onError }) {
  const [scores, setScores] = useState({ accuracy: existing?.accuracy ?? 0, difficulty: existing?.difficulty ?? 0, enjoyment: existing?.enjoyment ?? 0 })
  const [comment, setComment] = useState(existing?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const now = useNow(30000, Boolean(checkin), Date.parse(checkin?.finish_after))
  const timing = checkin ? checkinTiming(checkin, now) : null
  const complete = QUESTIONS.every(q => scores[q.key] > 0)
  const ready = complete && (!timing || timing.canFinish)

  async function run(action) {
    setBusy(true); setError(null)
    try { onSaved(await action()) }
    catch (err) { if (err.status === 401) onAuthLost(); else { setError(err.message); onError?.(err) } }
    finally { setBusy(false) }
  }

  function submit(e) {
    e.preventDefault()
    if (!ready) return
    const body = { ...scores, comment: comment.trim() || null }
    run(async () => checkin ? finishCheckin(checkin.id, body, await getToken()) : saveReview(trail.id, body, await getToken()))
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {QUESTIONS.map(q => (
        <div key={q.key}>
          <div className="text-sm font-medium">{q.label}</div>
          <div className="mb-1 text-xs text-stone-500">{q.hint}</div>
          <StarInput label={q.label} value={scores[q.key]} onChange={v => setScores(s => ({ ...s, [q.key]: v }))} />
        </div>
      ))}
      <div>
        <label htmlFor="review-comment" className="text-sm font-medium">Anything else? <span className="font-normal text-stone-500">(optional)</span></label>
        <textarea id="review-comment" value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={3} placeholder="Conditions, tips, what surprised you…" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        <div className="text-right text-xs text-stone-400">{comment.length}/1000</div>
      </div>
      {timing?.expired && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This check-in has expired (check-ins last 24 hours). Check in again at the trailhead.</p>}
      {timing && !timing.expired && !timing.canFinish && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">You can finish after {formatClock(checkin.finish_after, { ceil: true })}.</p>}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
      <div className="flex items-center gap-3">
        <button disabled={busy || !ready} className="rounded-lg bg-trail-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {checkin ? (busy ? 'Finishing…' : 'Finish hike') : existing ? 'Update review' : 'Submit review'}
        </button>
        {existing && !checkin && (
          <button type="button" disabled={busy} onClick={() => run(async () => deleteReview(trail.id, await getToken()))} className="text-sm text-red-700 underline disabled:opacity-50">Delete my review</button>
        )}
      </div>
      {!complete && <p className="text-xs text-stone-500">Rate all three to {checkin ? 'finish' : 'submit'}.</p>}
    </form>
  )
}

// After a finished hike: the badges it earned, if any. Takes focus when it replaces the form,
// so keyboard and screen-reader users land on the result.
function FinishSummary({ result, onClose }) {
  const badges = result?.new_badges || []
  const summary = useRef(null)
  useEffect(() => { summary.current?.focus() }, [])
  return (
    <div className="space-y-4">
      <div role="status" ref={summary} tabIndex={-1} className="outline-none">{badges.length ? (
        <>
          <p className="text-sm text-stone-600">Hike logged and rating saved. {badges.length === 1 ? 'You earned a new badge:' : `You earned ${badges.length} new badges:`}</p>
          <ul className="mt-2 space-y-2">
            {badges.map(b => (
              <li key={b.key} className="flex items-start gap-3 rounded-xl bg-[#f2f4ee] p-3">
                <span role="img" aria-label={`${TIER_LABEL[b.tier] || b.tier} badge`} className="text-3xl leading-none">{TIER_EMOJI[b.tier] || '🏅'}</span>
                <div><div className="font-bold">{b.title}</div><div className="text-sm text-stone-600">{b.description}</div></div>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="text-sm">Hike logged! You already have this trail's badge — keep going.</p>}</div>
      <button type="button" onClick={onClose} className="rounded-lg bg-trail-forest px-4 py-2 text-sm font-semibold text-white">Close</button>
    </div>
  )
}

// checkin (optional): finish mode for that active check-in. onCheckinDone(result) runs after a
// finish succeeds, and with null when the server says the check-in is gone or not finishable yet.
// badgeHint: review mode only; false hides the "start a check-in" hint (e.g. already checked in here).
export default function ReviewModal({ trail, checkin = null, badgeHint = true, onClose, onSaved, onCheckinDone }) {
  const { isAuthenticated, loginWithRedirect } = useAuth0()
  const getToken = useOptionalToken()
  const signedIn = AUTH_ENABLED && isAuthenticated
  const [existing, setExisting] = useState(undefined)  // undefined = still loading, null = none yet
  const [loadError, setLoadError] = useState(null)
  const [result, setResult] = useState(null)   // finish mode: FinishResult once completed

  function signOut() {  // expired or rejected token: log in again on Auth0
    loginWithRedirect()
  }

  // Prefill with the user's earlier review of this trail, if any.
  useEffect(() => {
    if (!signedIn) return
    setExisting(undefined); setLoadError(null)
    getToken()
      .then(token => getTrailReviews(trail.id, token))
      .then(r => setExisting(r.reviews.find(x => x.mine) ?? null))
      .catch(e => (e.status === 401 ? signOut() : setLoadError(e.message)))
  }, [signedIn, trail.id, getToken])

  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={checkin ? `Finish ${trail.name}` : `Review ${trail.name}`} onClick={e => e.stopPropagation()} className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          {result ? (
            <div><h2 className="text-lg font-bold">You finished {trail.name}!</h2></div>
          ) : checkin ? (
            <div>
              <h2 className="text-lg font-bold">Finish {trail.name} and rate it</h2>
              <p className="text-xs text-stone-500">Rate all three to complete your hike and log it toward your badges. A comment is optional.</p>
            </div>
          ) : (
            <div>
              <h2 className="text-lg font-bold">How was {trail.name}?</h2>
              <p className="text-xs text-stone-500">Your feedback helps other hikers and keeps our trail info honest.</p>
              {badgeHint && <p className="mt-1 text-xs text-stone-500">Want a badge? Start a check-in from the trail page when you're at the trailhead.</p>}
            </div>
          )}
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none text-stone-400 hover:text-stone-700">×</button>
        </div>
        {result ? (
          <FinishSummary result={result} onClose={onClose} />
        ) : !signedIn ? (
          <SignIn />
        ) : loadError && !checkin ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>
        ) : existing === undefined && !loadError ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : (
          // Finishing doesn't need the earlier review; if it couldn't be loaded, start from blank ratings.
          <ReviewForm trail={trail} existing={existing ?? null} checkin={checkin} getToken={getToken} onAuthLost={signOut}
            onSaved={checkin ? done => { setResult(done); onSaved(); onCheckinDone?.(done) } : () => { onSaved(); onClose() }}
            onError={checkin ? err => { if (err.status === 404 || err.status === 409) onCheckinDone?.(null) } : undefined} />
        )}
      </div>
    </div>
  )
}
