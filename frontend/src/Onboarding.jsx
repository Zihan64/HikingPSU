import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { getMe, register } from './api'
import { useOptionalToken } from './auth'

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'custom', label: 'Self-describe' },
]

const PSU = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
  { value: null, label: 'Rather not say' },
]

const EXPERIENCE = [
  { value: 0, label: 'Never hiked' },
  { value: 1, label: 'A few easy walks' },
  { value: 2, label: 'Occasional hiker' },
  { value: 3, label: 'Regular hiker' },
  { value: 4, label: 'Experienced' },
  { value: 5, label: 'Expert' },
]

// Values match preferences.transit_modes on the server.
const TRANSPORT = [
  { value: 'car', label: 'Car' },
  { value: 'bus', label: 'Bus / public transit' },
  { value: 'bike', label: 'Bike' },
  { value: 'walk', label: 'Walk' },
]

const STEPS = [
  { title: 'About you', hint: 'Only your first name is ever shown to other hikers.' },
  { title: 'Your hiking', hint: 'This shapes which trails we suggest and how you get there.' },
  { title: 'Contact details', hint: 'All optional. You can skip this page.' },
]

const today = () => new Date().toISOString().slice(0, 10)
const input = 'w-full min-h-[42px] rounded-xl border border-[#cfd8e3] bg-white px-3 py-2 text-sm focus:border-psu-beaver focus:outline-none focus:ring-2 focus:ring-psu-pugh/60'
const chosen = 'border-psu-beaver bg-psu-mist font-medium text-psu-navy'
const unchosen = 'border-[#cfd8e3] bg-white text-psu-slate hover:border-psu-pugh'
const primary = 'min-h-[42px] rounded-xl bg-psu-navy px-5 text-sm font-semibold text-white transition-colors hover:bg-psu-beaver disabled:opacity-40'
const quiet = 'min-h-[42px] rounded-xl px-3 text-sm text-psu-slate hover:text-psu-navy'

function Field({ label, optional, htmlFor, hint, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium text-psu-navy">
        {label} {optional ? <span className="font-normal text-psu-slate">(optional)</span> : <span className="text-red-600" aria-hidden="true">*</span>}
      </label>
      {hint && <p className="text-xs text-psu-slate">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

// Pill buttons. multiple=true makes them checkboxes over an array value.
function Choices({ name, options, value, onChange, multiple = false }) {
  const isOn = v => (multiple ? value.includes(v) : value === v)
  const toggle = v => onChange(multiple ? (value.includes(v) ? value.filter(x => x !== v) : [...value, v]) : v)
  return (
    <div className="flex flex-wrap gap-2" role={multiple ? 'group' : 'radiogroup'}>
      {options.map(o => (
        <label key={String(o.value)} className={`flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl border px-3.5 text-sm transition-colors ${isOn(o.value) ? chosen : unchosen}`}>
          <input type={multiple ? 'checkbox' : 'radio'} name={name} className="sr-only" checked={isOn(o.value)} onChange={() => toggle(o.value)} />
          {multiple && <span aria-hidden="true" className={`grid h-4 w-4 place-items-center rounded border text-[10px] ${isOn(o.value) ? 'border-psu-beaver bg-psu-beaver text-white' : 'border-[#b8c4d3]'}`}>{isOn(o.value) ? '✓' : ''}</span>}
          {o.label}
        </label>
      ))}
    </div>
  )
}

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
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    full_name: p.full_name ?? '',
    gender: p.gender ?? null,
    gender_custom: p.gender_custom ?? '',
    birthday: p.birthday ?? '',
    is_psu_student: p.is_psu_student ?? null,
    hiking_experience: p.hiking_experience ?? null,
    transit_modes: me.preferences.transit_modes ?? [],
    secondary_email: p.secondary_email ?? '',
    phone: p.phone ?? '',
    address: p.address ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const headingRef = useRef(null)
  const set = key => value => setForm(f => ({ ...f, [key]: value }))

  useEffect(() => { headingRef.current?.focus() }, [step])

  const stepDone = [
    form.full_name.trim() && form.gender && (form.gender !== 'custom' || form.gender_custom.trim()) && form.birthday,
    form.hiking_experience !== null && form.transit_modes.length > 0,
    true,
  ]

  async function save(withContact) {
    setBusy(true); setError(null)
    const { secondary_email, phone, address, ...rest } = form
    try {
      // Skipping page 3 sends no contact fields, so nothing saved there is touched.
      onDone(await register(withContact ? form : rest, await getToken()))
    } catch (err) {
      setError(err.message); setBusy(false)
    }
  }

  function next(e) {
    e.preventDefault()
    if (!stepDone[step] || busy) return
    if (step < 2) { setError(null); setStep(step + 1) } else save(true)
  }

  return (
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-gradient-to-b from-psu-navy to-[#0B2A55] p-4">
      <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center py-6">
        <p className="mb-4 text-center text-sm font-medium tracking-wide text-psu-pugh">Welcome to HikingPSU</p>
        <div role="dialog" aria-modal="true" aria-labelledby="ob-title" className="rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-5 flex gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-psu-beaver' : 'bg-[#e3e9f0]'}`} />)}
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-psu-slate">Step {step + 1} of 3</p>
          <h2 id="ob-title" ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-bold text-psu-navy focus:outline-none">{STEPS[step].title}</h2>
          <p className="mb-6 text-sm text-psu-slate">{STEPS[step].hint}</p>

          <form onSubmit={next} className="space-y-5">
            {step === 0 && <>
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
              <Field label="Are you a Penn State student?" optional>
                <Choices name="psu" options={PSU} value={form.is_psu_student} onChange={set('is_psu_student')} />
              </Field>
            </>}

            {step === 1 && <>
              <Field label="How much hiking have you done?">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup">
                  {EXPERIENCE.map(o => (
                    <label key={o.value} className={`cursor-pointer rounded-xl border px-1 py-2.5 text-center transition-colors ${form.hiking_experience === o.value ? chosen : unchosen}`}>
                      <input type="radio" name="experience" className="sr-only" checked={form.hiking_experience === o.value} onChange={() => set('hiking_experience')(o.value)} />
                      <div className="text-lg font-bold">{o.value}</div>
                      <div className="text-[11px] font-normal leading-tight">{o.label}</div>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="How can you get to a hike?" hint="Pick all that apply. If you pick Car, we'll assume you can drive.">
                <Choices name="transport" options={TRANSPORT} value={form.transit_modes} onChange={set('transit_modes')} multiple />
              </Field>
            </>}

            {step === 2 && <>
              <Field label="Secondary email" optional htmlFor="ob-email">
                <input id="ob-email" type="email" value={form.secondary_email} onChange={e => set('secondary_email')(e.target.value)} maxLength={254} autoComplete="email" placeholder={me.email ? `Besides ${me.email}` : undefined} className={input} />
              </Field>
              <Field label="Phone" optional htmlFor="ob-phone">
                <input id="ob-phone" type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} maxLength={20} autoComplete="tel" placeholder="+1 814 555 0100" className={input} />
              </Field>
              <Field label="Address" optional htmlFor="ob-address">
                <input id="ob-address" value={form.address} onChange={e => set('address')(e.target.value)} maxLength={200} autoComplete="street-address" placeholder="Street, city" className={input} />
              </Field>
            </>}

            {error && <p className="error-message" role="alert">{error}</p>}

            <div className="flex items-center justify-between gap-3 border-t border-[#e3e9f0] pt-5">
              {step === 0
                ? <button type="button" className={quiet} onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Log out</button>
                : <button type="button" className={quiet} disabled={busy} onClick={() => { setError(null); setStep(step - 1) }}>← Back</button>}
              <div className="flex items-center gap-2">
                {step === 2 && <button type="button" className={quiet} disabled={busy} onClick={() => save(false)}>Skip</button>}
                <button disabled={busy || !stepDone[step]} className={primary}>
                  {step < 2 ? 'Next' : busy ? 'Saving…' : 'Finish'}
                </button>
              </div>
            </div>
            {!stepDone[step] && <p className="text-right text-xs text-psu-slate">Fill in every field marked <span className="text-red-600">*</span> to continue.</p>}
          </form>
        </div>
      </div>
    </div>
  )
}
