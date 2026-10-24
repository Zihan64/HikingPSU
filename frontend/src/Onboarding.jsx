import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { getMe, register } from './api'
import { useOptionalToken } from './auth'

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'custom', label: 'Self-describe' },
]

const EXPERIENCE = [
  { value: 0, label: 'Never hiked' },
  { value: 1, label: 'A few easy walks' },
  { value: 2, label: 'Occasional hiker' },
  { value: 3, label: 'Regular hiker' },
  { value: 4, label: 'Experienced' },
  { value: 5, label: 'Expert' },
]

const TRANSPORT = [
  { value: 'car', label: 'Car' },
  { value: 'bus', label: 'Bus / public transit' },
  { value: 'bike_walk', label: 'Bike / walk' },
]

const today = () => new Date().toISOString().slice(0, 10)

function Field({ label, optional, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label} {optional ? <span className="font-normal text-[#73806e]">(optional)</span> : <span className="text-red-600">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Choices({ name, options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map(o => (
        <label key={o.value} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${value === o.value ? chosen : unchosen}`}>
          <input type="radio" name={name} className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}

const input = 'w-full min-h-[40px] rounded-lg border border-[#d8dfd1] bg-white px-3 py-2 text-sm'
const chosen = 'border-trail-forest bg-trail-sage font-medium text-trail-forest'
const unchosen = 'border-[#d8dfd1] bg-white hover:bg-[#f2f4ee]'

// Shown once after a new account's first login, until the form is saved. onSaved(user) lets the
// app refresh anything that depends on the profile (recommendations).
export default function Onboarding({ onSaved }) {
  const { isAuthenticated } = useAuth0()
  const getToken = useOptionalToken()
  const [me, setMe] = useState(null)

  useEffect(() => {
    if (!isAuthenticated) { setMe(null); return }
    let cancelled = false
    getToken()
      .then(token => token && getMe(token))
      .then(m => { if (!cancelled && m) setMe(m) })
      .catch(() => {})  // backend or database down: don't block the app with a form that can't save
    return () => { cancelled = true }
  }, [isAuthenticated, getToken])

  if (!me || me.registered) return null
  return <OnboardingForm me={me} getToken={getToken} onDone={user => { setMe(user); onSaved?.(user) }} />
}

export function OnboardingForm({ me, getToken, onDone }) {
  const { logout } = useAuth0()
  const p = me.profile
  const [form, setForm] = useState({
    gender: p.gender ?? null,
    gender_custom: p.gender_custom ?? '',
    full_name: p.full_name ?? '',
    birthday: p.birthday ?? '',
    hiking_experience: p.hiking_experience ?? null,
    transport: p.transport ?? null,
    preferences: me.preferences.notes ?? '',
    email: me.email ?? '',
    phone: p.phone ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = key => value => setForm(f => ({ ...f, [key]: value }))

  const complete = form.gender && (form.gender !== 'custom' || form.gender_custom.trim())
    && form.full_name.trim() && form.birthday && form.hiking_experience !== null && form.transport

  async function submit(e) {
    e.preventDefault()
    if (!complete) return
    setBusy(true); setError(null)
    try {
      onDone(await register(form, await getToken()))
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-label="Tell us about yourself" className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 text-trail-ink shadow-xl">
        <h2 className="text-lg font-bold">Welcome to HikingPSU!</h2>
        <p className="mb-4 text-xs text-[#73806e]">Tell us a bit about yourself so we can suggest the right trails. Only your first name is ever shown to others.</p>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" htmlFor="ob-name">
            <input id="ob-name" value={form.full_name} onChange={e => set('full_name')(e.target.value)} maxLength={60} autoComplete="name" className={input} />
          </Field>

          <Field label="Gender">
            <Choices name="gender" options={GENDERS} value={form.gender} onChange={set('gender')} />
            {form.gender === 'custom' && (
              <input aria-label="Describe your gender" value={form.gender_custom} onChange={e => set('gender_custom')(e.target.value)} maxLength={40} placeholder="How do you describe your gender?" className={`${input} mt-2`} />
            )}
          </Field>

          <Field label="Birthday" htmlFor="ob-birthday">
            <input id="ob-birthday" type="date" value={form.birthday} onChange={e => set('birthday')(e.target.value)} min="1900-01-01" max={today()} autoComplete="bday" className={input} />
          </Field>

          <Field label="How much hiking have you done?">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup">
              {EXPERIENCE.map(o => (
                <label key={o.value} className={`cursor-pointer rounded-lg border px-1 py-2 text-center ${form.hiking_experience === o.value ? chosen : unchosen}`}>
                  <input type="radio" name="experience" className="sr-only" checked={form.hiking_experience === o.value} onChange={() => set('hiking_experience')(o.value)} />
                  <div className="text-lg font-bold">{o.value}</div>
                  <div className="text-[11px] font-normal leading-tight text-[#5b6a58]">{o.label}</div>
                </label>
              ))}
            </div>
          </Field>

          <Field label="How do you usually get to a hike?">
            <Choices name="transport" options={TRANSPORT} value={form.transport} onChange={set('transport')} />
          </Field>

          <div className="border-t border-[#e0e5dc] pt-4 space-y-4">
            <Field label="Preferences" optional htmlFor="ob-prefs">
              <textarea id="ob-prefs" value={form.preferences} onChange={e => set('preferences')(e.target.value)} maxLength={500} rows={2} placeholder="Views, lakes, quiet trails, dog-friendly…" className={input} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" optional htmlFor="ob-email">
                <input id="ob-email" type="email" value={form.email} onChange={e => set('email')(e.target.value)} maxLength={254} autoComplete="email" className={input} />
              </Field>
              <Field label="Phone" optional htmlFor="ob-phone">
                <input id="ob-phone" type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} maxLength={20} autoComplete="tel" placeholder="+1 814 555 0100" className={input} />
              </Field>
            </div>
          </div>

          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} className="text-button">
              Log out
            </button>
            <button disabled={busy || !complete} className="primary-button">
              {busy ? 'Saving…' : 'Save and start'}
            </button>
          </div>
          {!complete && <p className="text-right text-xs text-[#73806e]">Fill in every field marked * to continue.</p>}
        </form>
      </div>
    </div>
  )
}
