import { useState } from 'react'
import { chat } from './api'
import TrailCard from './TrailCard'
import MapView from './MapView'

const SUGGESTIONS = [
  'Saturday afternoon, two of us, no car, ~3 hours, want a view',
  'Something easy for a first-time hiker, near campus',
  'I have a car, want something hard with rocks on Sunday',
]

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [trails, setTrails] = useState([])
  const [hasCar, setHasCar] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function send(text) {
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next); setInput(''); setLoading(true); setError(null)
    try {
      const res = await chat(next, { has_car: hasCar })
      setMessages([...next, { role: 'assistant', content: res.reply }])
      if (res.trails.length) setTrails(res.trails)
    } catch (e) {
      setError(e.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 md:grid-cols-[1fr_1.1fr]">
      <section className="flex flex-col">
        <header className="mb-3">
          <h1 className="text-2xl font-bold">Trailhead</h1>
          <p className="text-sm text-stone-500">Hikes around Happy Valley, rated for real people.</p>
        </header>

        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hasCar} onChange={e => setHasCar(e.target.checked)} /> I have a car
        </label>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-stone-200 bg-white p-3" style={{ minHeight: 320, maxHeight: 480 }}>
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-stone-500">Try one of these:</p>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} className="block w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:bg-stone-50">{s}</button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'ml-8 bg-emerald-50' : 'mr-8 bg-stone-100'}`}>{m.content}</div>
          ))}
          {loading && <div className="mr-8 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-500">Checking trails, weather, hunting season…</div>}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>

        <form onSubmit={e => { e.preventDefault(); if (input.trim()) send(input.trim()) }} className="mt-3 flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Describe your hike…" className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          <button disabled={loading} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send</button>
        </form>
      </section>

      <section className="space-y-3">
        {trails.length > 0 && <MapView trails={trails} />}
        {trails.map(t => <TrailCard key={t.id} t={t} />)}
        {trails.length === 0 && <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-400">Recommendations show up here.</div>}
      </section>
    </div>
  )
}
