import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { deleteReview, getTrailReviews, saveReview } from './api'
import { AUTH_ENABLED, useOptionalToken } from './auth'
import { StarInput } from './Stars'

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
      <button onClick={() => loginWithRedirect()} className="w-full rounded-lg bg-psu-navy px-4 py-2 text-sm font-semibold text-white">
        Log in or sign up
      </button>
    </div>
  )
}

function ReviewForm({ trail, existing, getToken, onSaved, onAuthLost }) {
  const [scores, setScores] = useState({ accuracy: existing?.accuracy ?? 0, difficulty: existing?.difficulty ?? 0, enjoyment: existing?.enjoyment ?? 0 })
  const [comment, setComment] = useState(existing?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const complete = QUESTIONS.every(q => scores[q.key] > 0)

  async function run(action) {
    setBusy(true); setError(null)
    try { await action(); onSaved() }
    catch (err) { err.status === 401 ? onAuthLost() : setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); if (complete) run(async () => saveReview(trail.id, { ...scores, comment: comment.trim() || null }, await getToken())) }} className="space-y-4">
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
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-3">
        <button disabled={busy || !complete} className="rounded-lg bg-psu-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {existing ? 'Update review' : 'Submit review'}
        </button>
        {existing && (
          <button type="button" disabled={busy} onClick={() => run(async () => deleteReview(trail.id, await getToken()))} className="text-sm text-red-700 underline disabled:opacity-50">Delete my review</button>
        )}
      </div>
      {!complete && <p className="text-xs text-stone-500">Rate all three to submit.</p>}
    </form>
  )
}

export default function ReviewModal({ trail, onClose, onSaved }) {
  const { isAuthenticated, loginWithRedirect } = useAuth0()
  const getToken = useOptionalToken()
  const signedIn = AUTH_ENABLED && isAuthenticated
  const [existing, setExisting] = useState(undefined)  // undefined = still loading, null = none yet
  const [loadError, setLoadError] = useState(null)

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
      <div role="dialog" aria-modal="true" aria-label={`Review ${trail.name}`} onClick={e => e.stopPropagation()} className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">How was {trail.name}?</h2>
            <p className="text-xs text-stone-500">Your feedback helps other hikers and keeps our trail info honest.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none text-stone-400 hover:text-stone-700">×</button>
        </div>
        {!signedIn ? (
          <SignIn />
        ) : loadError ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>
        ) : existing === undefined ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : (
          <ReviewForm trail={trail} existing={existing} getToken={getToken} onSaved={() => { onSaved(); onClose() }} onAuthLost={signOut} />
        )}
      </div>
    </div>
  )
}
