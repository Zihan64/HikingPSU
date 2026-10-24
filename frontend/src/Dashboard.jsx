import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { addHike, deleteHike, getInsights, getMe, listHikes, parsePreferences, patchMe } from './api'
import { useOptionalToken } from './auth'
import { LEVEL_HEX, LEVEL_LABELS } from './levels'

const FEATURES = ['view', 'lake', 'forest', 'stream', 'flat', 'sunset', 'wildlife', 'rocks', 'steep', 'shade', 'campus']
const AVOID = ['steep', 'rocks', 'mud', 'crowds']
const TRANSIT =[['walk', 'Walk'], ['bus', 'Bus (CATA)'], ['bike', 'Bike'], ['car', 'Car']]
const SEASONS = ['spring', 'summer', 'fall', 'winter']
const GROUPS = [['solo', 'Solo'], ['friends', 'Friends'], ['family', 'Family'], ['club', 'Club']]
const withSaved = (options, saved) => [...new Set([...options, ...saved])]
const inputCls ='min-h-[40px] rounded-lg border border-[#d8dfd1] bg-white px-2 py-1.5 text-sm'
const GREEN = '#2F6B47'

function Card({ title, hint, children }) {
  return (
    <section className="rounded-2xl border border-[#e0e5dc] bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mb-2 text-xs text-[#73806e]">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </section>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-[#e0e5dc] bg-white p-3">
      <div className="text-2xl font-bold" style={{ color: GREEN }}>{value}</div>
      <div className="text-xs text-[#73806e]">{label}</div>
    </div>
  )
}

// Toggleable pills for list-valued fields.
function Chips({ options, value, onToggle }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const [key, label] = Array.isArray(o) ? o : [o, o]
        const on = value.includes(key)
        return (
          <button key={key} type="button" aria-pressed={on} onClick={() => onToggle(key)}
            className={`min-h-[36px] rounded-full border px-3 py-1 text-xs capitalize ${on ? 'border-[#2F6B47] bg-[#2F6B47] text-white' : 'border-[#d8dfd1] bg-white hover:bg-[#f2f4ee]'}`}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

function Bars({ rows, color = '#658559' }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 capitalize text-[#5b6a58]">{r.label}</span>
          <div className="h-3 flex-1 rounded bg-[#eef1e9]">
            <div className="h-3 rounded" style={{ width: `${(r.value / max) * 100}%`, background: r.color || color }} />
          </div>
          <span className="w-6 text-right tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard({ trails }) {
  const { isAuthenticated, isLoading, loginWithPopup } = useAuth0()
  const getToken = useOptionalToken()
  const [me, setMe] = useState(null)
  const [insights, setInsights] = useState(null)
  const [hikes, setHikes] = useState([])
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    try {
      const [m, i, h] = await Promise.all([getMe(token), getInsights(token), listHikes(token)])
      setMe(m); setInsights(i); setHikes(h); setError(null)
    } catch (e) { setError(e.message) }
  }, [getToken])

  useEffect(() => { if (isAuthenticated) load() }, [isAuthenticated, load])

  if (isLoading) return <p className="p-6 text-sm text-[#73806e]">Loading…</p>
  if (!isAuthenticated) {
    return (
      <div className="rounded-2xl border border-dashed border-[#c9d2c2] p-10 text-center">
        <p className="mb-3 text-sm">Log in to build your hiker profile and track the trails you have done.</p>
        <button className="primary-button" onClick={() => loginWithPopup()}>Log in</button>
      </div>
    )
  }
  if (error) return <p className="error-message" role="alert">{error}</p>
  if (!me || !insights) return <p className="p-6 text-sm text-[#73806e]">Loading your dashboard…</p>

  // Saves one section; the server returns the full user, then insights refresh (completeness changes).
  async function save(changes) {
    try {
      const token = await getToken()
      setMe(await patchMe(changes, token))
      setInsights(await getInsights(token))
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    } catch (e) { setError(e.message) }
  }
  const setProfile = (k, v) => save({ profile: { [k]: v } })
  const setPref = (k, v) => save({ preferences: { [k]: v } })
  const toggle = (list, key) => (list.includes(key) ? list.filter(x => x !== key) : [...list, key])
  const num = (v, min, max) => (v === '' ? null : Math.min(max, Math.max(min, Number(v))))

  const { profile, preferences: prefs } = me
  const s = insights.stats
  const levelRows = [1, 2, 3, 4, 5].map(l => ({ label: `L${l} ${LEVEL_LABELS[l]}`, value: insights.level_counts[l] || 0, color: LEVEL_HEX[l] }))
  const affinity = Object.entries(insights.feature_affinity).sort((a, b) => b[1] - a[1])
  const felt = insights.felt_vs_official

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <span className="eyebrow">YOUR PROFILE</span>
          <h1 className="mt-2 text-[clamp(24px,2.3vw,34px)] font-semibold leading-tight tracking-tight">Your hiker profile</h1>
          <p className="mt-2 text-[13px] text-[#73806e]">What you tell us and what you hike shapes your recommendations.</p>
        </div>
        <div className="w-40 shrink-0 text-right text-xs text-[#73806e]">
          <span role="status">{saved ? 'Saved ✓' : `Profile ${insights.profile_completeness}% complete`}</span>
          <div className="mt-1 h-2 rounded bg-[#e3e8dd]"><div className="h-2 rounded" style={{ width: `${insights.profile_completeness}%`, background: GREEN }} /></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="hikes logged" value={s.total_hikes} />
        <Stat label="unique trails" value={`${s.unique_trails}/${trails.length}`} />
        <Stat label="miles hiked" value={s.total_distance_mi} />
        <Stat label="ft climbed" value={s.total_elevation_gain_ft.toLocaleString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="About you">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">Age
              <input type="number" key={profile.age} defaultValue={profile.age ?? ''} className={inputCls} min={10} max={110}
                onBlur={e => { const v = num(e.target.value, 10, 110); if (v !== profile.age) setProfile('age', v) }} />
            </label>
            <label className="flex flex-col gap-1">Home area
              <input key={profile.home_area} defaultValue={profile.home_area ?? ''} className={inputCls} maxLength={80} placeholder="e.g. East Halls"
                onBlur={e => { const v = e.target.value.trim() || null; if (v !== profile.home_area) setProfile('home_area', v) }} />
            </label>
            <label className="flex flex-col gap-1">Fitness
              <select className={inputCls} value={profile.fitness ?? ''} onChange={e => setProfile('fitness', num(e.target.value, 1, 5))}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}{n === 1 ? ' – new to hiking' : n === 5 ? ' – very fit' : ''}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">Usually hike
              <select className={inputCls} value={profile.group_type ?? ''} onChange={e => setProfile('group_type', e.target.value || null)}>
                <option value="">—</option>
                {GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
        </Card>

        <Card title="Getting to the trailhead" hint="Pick every way you can realistically get there.">
          <Chips options={TRANSIT} value={prefs.transit_modes} onToggle={k => {
            const modes = toggle(prefs.transit_modes, k)
            save({ preferences: { transit_modes: modes }, profile: { has_car: modes.includes('car') } })
          }} />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">Max drive (min)
              <input type="number" key={prefs.max_drive_min} defaultValue={prefs.max_drive_min ?? ''} className={inputCls} min={0} max={600}
                onBlur={e => { const v = num(e.target.value, 0, 600); if (v !== prefs.max_drive_min) setPref('max_drive_min', v) }} />
            </label>
            <label className="flex flex-col gap-1">Max hike time (min)
              <input type="number" key={prefs.max_time_min} defaultValue={prefs.max_time_min ?? ''} className={inputCls} min={1} max={1440}
                onBlur={e => { const v = num(e.target.value, 1, 1440); if (v !== prefs.max_time_min) setPref('max_time_min', v) }} />
            </label>
          </div>
        </Card>

        <Card title="What you like" hint="Features you look for in a trail.">
          {/* saved values outside the preset list (e.g. from "Describe what you like") still get a chip so they can be removed */}
          <Chips options={withSaved(FEATURES, prefs.preferred_features)} value={prefs.preferred_features} onToggle={k => setPref('preferred_features', toggle(prefs.preferred_features, k))} />
          <div className="mt-3 text-xs text-[#73806e]">Rather avoid</div>
          <div className="mt-1"><Chips options={withSaved(AVOID, prefs.avoid)} value={prefs.avoid} onToggle={k => setPref('avoid', toggle(prefs.avoid, k))} /></div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">Hardest level you want
              <select className={inputCls} value={prefs.max_level ?? ''} onChange={e => setPref('max_level', num(e.target.value, 1, 5))}>
                <option value="">Any</option>
                {[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>L{l} {LEVEL_LABELS[l]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">Trail shape
              <select className={inputCls} value={prefs.prefers_loop == null ? '' : String(prefs.prefers_loop)}
                onChange={e => setPref('prefers_loop', e.target.value === '' ? null : e.target.value === 'true')}>
                <option value="">No preference</option>
                <option value="true">Loops</option>
                <option value="false">Out-and-back</option>
              </select>
            </label>
          </div>
          <div className="mt-3 text-xs text-[#73806e]">Favorite seasons</div>
          <div className="mt-1"><Chips options={SEASONS} value={prefs.preferred_seasons} onToggle={k => setPref('preferred_seasons', toggle(prefs.preferred_seasons, k))} /></div>
        </Card>

        <LogHike trails={trails} onAdd={async h => { await addHike(h, await getToken()); await load() }} />
        <DescribeYourself getToken={getToken} onApply={save} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Trails by difficulty">
          {s.total_hikes ? <Bars rows={levelRows} /> : <p className="text-xs text-[#73806e]">Log a hike to see this.</p>}
          {insights.comfortable_level && (
            <p className="mt-3 text-xs text-[#5b6a58]">Comfort zone: up to <b>L{insights.comfortable_level} {LEVEL_LABELS[insights.comfortable_level]}</b>
              {felt != null && <> · you find trails {Math.abs(felt) < 0.25 ? 'about as hard as rated' : felt > 0 ? `harder than rated (+${felt})` : `easier than rated (${felt})`}</>}
              {insights.avg_rating != null && <> · avg rating {insights.avg_rating}★</>}
            </p>
          )}
        </Card>
        <Card title="Your taste" hint="Features of trails you have done, shaded by how highly you rated them.">
          {affinity.length ? (
            <div className="flex flex-wrap gap-1.5">
              {affinity.slice(0, 14).map(([f, a]) => (
                <span key={f} title={`affinity ${a}`} className="rounded-full px-2.5 py-1 text-xs"
                  style={{ background: a > 0.25 ? '#dcebd5' : a < -0.25 ? '#fbe3dc' : '#f2f4ee', color: a > 0.25 ? '#225e45' : a < -0.25 ? '#9b3e2e' : '#5b6a58' }}>
                  {f}
                </span>
              ))}
            </div>
          ) : <p className="text-xs text-[#73806e]">Rate a few hikes and your preferences show up here.</p>}
          {s.total_hikes > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-[#5b6a58]">
              <div><div className="mb-1 font-medium">Seasons</div><Bars rows={Object.entries(insights.season_counts).map(([label, value]) => ({ label, value }))} color="#d97706" /></div>
              <div><div className="mb-1 font-medium">Areas</div><Bars rows={insights.top_areas.map(a => ({ label: a.key, value: a.count }))} /></div>
            </div>
          )}
        </Card>
      </div>

      <Card title={`Hike log (${hikes.length})`}>
        {hikes.length === 0 && <p className="text-xs text-[#73806e]">Nothing logged yet.</p>}
        <ul className="divide-y divide-[#eef1e9]">
          {hikes.map(h => (
            <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div>
                <div className="font-medium">{h.trail_name}</div>
                <div className="text-xs text-[#73806e]">{h.completed_on}{h.rating ? ` · ${'★'.repeat(h.rating)}` : ''}{h.felt_difficulty ? ` · felt ${h.felt_difficulty}/5` : ''}{h.duration_min ? ` · ${h.duration_min} min` : ''}</div>
              </div>
              <button className="text-button" onClick={async () => {
                if (!confirm(`Remove "${h.trail_name}" from your log?`)) return
                await deleteHike(h.id, await getToken()); load()
              }}>Remove</button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

// Free text -> suggested settings. The server only suggests; nothing changes until "Apply".
function DescribeYourself({ getToken, onApply }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [suggestion, setSuggestion] = useState(null)

  async function suggest(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setErr(null); setSuggestion(null)
    try { setSuggestion(await parsePreferences(text.trim(), await getToken())) } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  // Only fields the text actually set; transit choices keep has_car in sync like the chips above.
  const changes = suggestion && Object.fromEntries(
    ['max_level', 'preferred_features', 'avoid', 'transit_modes', 'max_time_min', 'prefers_loop']
      .filter(k => suggestion[k] != null && !(Array.isArray(suggestion[k]) && !suggestion[k].length))
      .map(k => [k, suggestion[k]]))
  const rows = changes && [
    changes.max_level && `Hardest level: L${changes.max_level} ${LEVEL_LABELS[changes.max_level]}`,
    changes.preferred_features && `Likes: ${changes.preferred_features.join(', ')}`,
    changes.avoid && `Avoids: ${changes.avoid.join(', ')}`,
    changes.transit_modes && `Gets there by: ${changes.transit_modes.join(', ')}`,
    changes.max_time_min && `Max hike time: ${changes.max_time_min} min`,
    changes.prefers_loop != null && (changes.prefers_loop ? 'Prefers loops' : 'Prefers out-and-back'),
  ].filter(Boolean)

  async function apply() {
    const body = { preferences: changes }
    if (changes.transit_modes) body.profile = { has_car: changes.transit_modes.includes('car') }
    await onApply(body)
    setSuggestion(null); setText('')
  }

  return (
    <Card title="Describe what you like" hint="In your own words. We'll suggest settings for you to check before anything is saved.">
      <form onSubmit={suggest} className="grid gap-2 text-sm">
        <textarea className={`${inputCls} min-h-[72px]`} maxLength={500} value={text} onChange={e => setText(e.target.value)}
          placeholder="e.g. a bit out of shape, love lakes and views, hate mud, no car, 2 hours max" />
        <button disabled={busy || !text.trim()} className="primary-button">{busy ? 'Thinking…' : 'Suggest settings'}</button>
      </form>
      {err && <p className="error-message mt-2" role="alert">{err}</p>}
      {suggestion && (
        <div className="mt-3 rounded-xl bg-[#f2f4ee] p-3 text-sm" role="status">
          {rows.length ? (
            <>
              <ul className="list-disc pl-5">{rows.map(r => <li key={r}>{r}</li>)}</ul>
              <div className="mt-2 flex gap-2">
                <button type="button" className="primary-button" onClick={apply}>Apply</button>
                <button type="button" className="text-button" onClick={() => setSuggestion(null)}>Discard</button>
              </div>
            </>
          ) : <p className="text-xs text-[#73806e]">We couldn't pick out any settings from that. Try mentioning difficulty, features, transport or time.</p>}
        </div>
      )}
    </Card>
  )
}

function LogHike({ trails, onAdd }) {
  const today = new Date().toISOString().slice(0, 10)
  const blank = { trail_id: '', completed_on: today, rating: '', felt_difficulty: '', duration_min: '' }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const opt = v => (v === '' ? undefined : Number(v))

  async function submit(e) {
    e.preventDefault()
    if (!f.trail_id) return
    setBusy(true); setErr(null)
    try {
      await onAdd({ trail_id: f.trail_id, completed_on: f.completed_on, rating: opt(f.rating), felt_difficulty: opt(f.felt_difficulty), duration_min: opt(f.duration_min) })
      setF(blank)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  const scale = [1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)

  return (
    <Card title="Log a hike" hint="Ratings are what teach the recommender what you enjoy.">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-2 flex flex-col gap-1">Trail
          <select required className={inputCls} value={f.trail_id} onChange={e => set('trail_id', e.target.value)}>
            <option value="">Choose a trail…</option>
            {trails.map(t => <option key={t.id} value={t.id}>{t.name} (L{t.difficulty.level})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Date
          <input type="date" required max={today} className={inputCls} value={f.completed_on} onChange={e => set('completed_on', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">Duration (min)
          <input type="number" min={1} max={1440} className={inputCls} value={f.duration_min} onChange={e => set('duration_min', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">Enjoyment (1–5)
          <select className={inputCls} value={f.rating} onChange={e => set('rating', e.target.value)}><option value="">—</option>{scale}</select>
        </label>
        <label className="flex flex-col gap-1">How hard it felt (1–5)
          <select className={inputCls} value={f.felt_difficulty} onChange={e => set('felt_difficulty', e.target.value)}><option value="">—</option>{scale}</select>
        </label>
        {err && <p className="error-message col-span-2" role="alert">{err}</p>}
        <button disabled={busy} className="primary-button col-span-2">{busy ? 'Saving…' : 'Add to my log'}</button>
      </form>
    </Card>
  )
}
