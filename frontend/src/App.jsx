import { useEffect, useState } from 'react'
import { chat, getReviewSummaries, listTrails } from './api'
import TrailCard from './TrailCard'
import MapView from './MapView'
import ReviewModal from './ReviewModal'
import { LEVEL_HEX, LEVEL_LABELS } from './levels'
import AuthButton from './AuthButton'
import Onboarding from './Onboarding'
import { AUTH_ENABLED, useOptionalToken } from './auth'

const SUGGESTIONS = [
  'Saturday afternoon, two of us, no car, ~3 hours, want a view',
  'Something easy for a first-time hiker, near campus',
  'I have a car, want something hard with rocks on Sunday',
]

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [allTrails, setAllTrails] = useState([])      // every trail, loaded on page open
  const [recommended, setRecommended] = useState([])  // what the agent picked
  const [selectedId, setSelectedId] = useState(null)
  const [hasCar, setHasCar] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [summaries, setSummaries] = useState({})      // trail id -> average review scores
  const [reviewing, setReviewing] = useState(null)    // trail currently being reviewed
  const [reviewsVersion, setReviewsVersion] = useState(0)
  const [sessionId, setSessionId] = useState(null)   // saved chat (logged-in users only)
  const [me, setMe] = useState(null)                  // the logged-in user's account, from /me
  const getToken = useOptionalToken()                 // null when logged out or login isn't configured

  const refreshSummaries = () => getReviewSummaries().then(setSummaries).catch(() => {})  // reviews are optional; trails still work

  useEffect(() => {
    listTrails()
      .then(ts => setAllTrails([...ts].sort((a, b) => a.difficulty.level - b.difficulty.level || a.distance_mi - b.distance_mi)))
      .catch(() => setLoadError("Couldn't load trails. Is the backend running on port 8000?"))
    refreshSummaries()
  }, [])

  // Start the car checkbox from how the user said they get to hikes.
  useEffect(() => {
    if (typeof me?.profile.has_car === 'boolean') setHasCar(me.profile.has_car)
  }, [me])

  async function send(text) {
    if (loading) return
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next); setInput(''); setLoading(true); setError(null)
    try {
      // Logged in: send the token so the server uses the saved profile/hike history and saves this chat.
      const res = await chat(next, { has_car: hasCar }, { token: await getToken(), sessionId })
      if (res.session_id) setSessionId(res.session_id)
      setMessages([...next, { role: 'assistant', content: res.reply }])
      setRecommended(res.trails); setSelectedId(null)
    } catch (e) {
      setError(e.message)
    } finally { setLoading(false) }
  }

  const recIds = recommended.map(t => t.id)
  const mapTrails = allTrails.length ? allTrails : recommended   // map still works if /trails failed
  const cards = recommended.length ? recommended : allTrails

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 md:grid-cols-[1fr_1.1fr]">
      <section className="flex flex-col">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">HikingPSU</h1>
            <p className="text-sm text-stone-500">Hikes around Happy Valley, rated for real people.</p>
          </div>
          {AUTH_ENABLED && <AuthButton onMe={setMe} />}
        </header>

        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hasCar} onChange={e => setHasCar(e.target.checked)} /> I have a car
        </label>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-stone-200 bg-white p-3" style={{ minHeight: 320, maxHeight: 480 }}>
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-stone-500">Try one of these:</p>
              {SUGGESTIONS.map(s => (
                <button key={s} disabled={loading} onClick={() => send(s)} className="block w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:bg-stone-50">{s}</button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'ml-8 bg-emerald-50' : 'mr-8 bg-stone-100'}`}>{m.content}</div>
          ))}
          {loading && <div className="mr-8 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-500">Finding matching trails…</div>}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>

        <form onSubmit={e => { e.preventDefault(); if (input.trim()) send(input.trim()) }} className="mt-3 flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Describe your hike…" className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          <button disabled={loading} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send</button>
        </form>
      </section>

      <section className="space-y-3">
        {mapTrails.length > 0 && (
          <>
            <MapView trails={mapTrails} recIds={recIds} selectedId={selectedId} onSelect={setSelectedId} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
              {[1, 2, 3, 4, 5].map(l => (
                <span key={l} className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: LEVEL_HEX[l] }} />
                  L{l} {LEVEL_LABELS[l]}
                </span>
              ))}
            </div>
          </>
        )}
        {loadError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>}

        {cards.length > 0 && (
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-700">
              {recommended.length ? 'Recommended for you' : `All trails (${allTrails.length})`}
            </h2>
            {recommended.length > 0 && (
              <button onClick={() => { setRecommended([]); setSelectedId(null) }} className="text-xs text-emerald-800 underline">
                Show all trails
              </button>
            )}
          </div>
        )}
        {cards.map(t => (
          <TrailCard key={t.id} t={t} selected={t.id === selectedId} onSelect={() => setSelectedId(t.id)}
            summary={summaries[t.id]} onReview={() => setReviewing(t)} reviewsVersion={reviewsVersion} />
        ))}
        {!loadError && cards.length === 0 && (
          <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-400">Loading trails…</div>
        )}
      </section>
      {me && !me.registered && <Onboarding me={me} onDone={setMe} />}
      {reviewing && (
        <ReviewModal trail={reviewing} onClose={() => setReviewing(null)} onSaved={() => { refreshSummaries(); setReviewsVersion(v => v + 1) }} />
      )}
    </div>
  )
}
