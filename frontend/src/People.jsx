import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { setFollowing } from './api'
import { AUTH_ENABLED, useOptionalToken } from './auth'
import { plural } from './checkin'
import { profileUrl, useOpenProfile } from './profileLink'

const PREVIEW_NOTICE = 'Sign-in is unavailable in this preview. Open the configured HikingPSU site to log in.'
const pick = u => ({ following: u.following, followers_count: u.followers_count })

// Follow state for one hiker (a UserCard or PublicProfile). toggle() updates at once and rolls back
// if the server refuses; signed out it opens the Auth0 pop-up instead. onChange(state, before) runs after a save.
export function useFollow(user, onChange) {
  const { isAuthenticated, loginWithPopup } = useAuth0()
  const getToken = useOptionalToken()
  const [state, setState] = useState(() => pick(user))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  // Every fresh copy from the server wins, even when it repeats the values this row started with
  // (a search run again after you unfollowed on their profile).
  useEffect(() => { setState(pick(user)) }, [user])

  async function toggle() {
    if (!AUTH_ENABLED) { setNotice(PREVIEW_NOTICE); return }
    if (!isAuthenticated) { loginWithPopup(); return }
    if (busy) return
    const before = state
    const following = !state.following
    setBusy(true); setNotice(null)
    setState({ following, followers_count: Math.max(0, state.followers_count + (following ? 1 : -1)) })
    try {
      const token = await getToken()
      if (!token) throw Object.assign(new Error('authentication required'), { status: 401 })
      const next = await setFollowing(user.handle, following, token)
      setState(next)
      onChange?.(next, before)
    } catch (err) {
      setState(before)
      setNotice(err.status === 401 ? 'Your login has expired. Log in again to follow hikers.'
        : `Couldn't ${following ? 'follow' : 'unfollow'} ${user.display_name}. Try again.`)
    } finally { setBusy(false) }
  }

  return { ...state, busy, notice, signedIn: AUTH_ENABLED && isAuthenticated, toggle }
}

// Follow / Following (select again to unfollow); "Log in to follow" when signed out.
export function FollowButton({ follow, name, large = false }) {
  const size = large ? 'min-h-[44px] px-4 text-sm' : 'min-h-[36px] px-3 text-xs'
  const label = !follow.signedIn ? 'Log in to follow' : follow.following ? 'Following' : 'Follow'
  const look = follow.signedIn && follow.following
    ? 'border border-[#2f6b47] bg-white text-[#2f6b47] hover:bg-[#e6f1df]'
    : 'bg-[#2f6b47] text-white hover:bg-[#3e8558]'
  return (
    <button type="button" disabled={follow.busy} onClick={e => { e.stopPropagation(); follow.toggle() }}
      aria-pressed={follow.signedIn ? Boolean(follow.following) : undefined}
      aria-label={follow.signedIn ? `${label} ${name}` : undefined}
      title={follow.signedIn && follow.following ? `Unfollow ${name}` : undefined}
      className={`shrink-0 rounded-lg font-semibold ${size} ${look}`}>
      {label}
    </button>
  )
}

export function Avatar({ name, large = false }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-[#e6f1df] font-semibold text-[#2f6b47] ${large ? 'h-14 w-14 text-xl' : 'h-9 w-9 text-sm'}`}>
      {(name || '?').trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

// A hiker's name that opens their profile when there is a handle and an App to open it in;
// otherwise plain text styled with `plain`.
export function ProfileName({ handle, plain = '', children }) {
  const openProfile = useOpenProfile()
  if (!handle || !openProfile) return <span className={plain}>{children}</span>
  return (
    <button type="button" className="inline-flex min-h-[24px] items-center text-left font-semibold text-[#2c7fbf] underline underline-offset-2 hover:text-[#2f6b47]"
      onClick={e => { e.stopPropagation(); openProfile(handle) }} title={`View @${handle}'s profile`}>
      {children}
    </button>
  )
}

// One UserCard: name, @handle, badges and followers. Selecting it opens the profile;
// signed-in viewers can follow from the row (never themselves).
export function UserCardRow({ user, onFollowChange }) {
  const openProfile = useOpenProfile()
  const follow = useFollow(user, onFollowChange)
  const hidden = !user.is_public && !user.is_me
  const meta = [`@${user.handle}`, hidden ? 'Private profile' : plural(user.badge_count, 'badge'), plural(follow.followers_count, 'follower')].join(' · ')
  const body = <>
    <Avatar name={user.display_name} />
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold text-[#173a40]">{user.display_name}{user.is_me && ' (you)'}</span>
      <span className="block truncate text-xs text-[#73806e]">{meta}</span>
    </span>
  </>
  return (
    <li className="rounded-xl border border-[#e0e5dc] bg-white p-2">
      <div className="flex items-center gap-2">
        {openProfile
          ? <button type="button" className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left hover:bg-[#f5f8f2]" onClick={() => openProfile(user.handle)}>{body}</button>
          : <div className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 px-1">{body}</div>}
        {follow.signedIn && !user.is_me && <FollowButton follow={follow} name={user.display_name} />}
      </div>
      {follow.notice && <p className="mt-1 px-1 text-xs text-[#9b3e2e]" role="alert">{follow.notice}</p>}
    </li>
  )
}

// Copies <origin>/?u=<handle>; without clipboard access the link is shown to copy by hand.
export function CopyProfileLink({ handle }) {
  const [state, setState] = useState(null)   // 'copied' | 'manual'
  const manualInput = useRef(null)
  const url = profileUrl(handle, window.location?.origin ?? '')
  useEffect(() => { setState(null) }, [handle])
  useEffect(() => {
    if (state === 'manual') manualInput.current?.focus()   // selects the link, ready to copy
    if (state !== 'copied') return
    const id = setTimeout(() => setState(null), 2000)
    return () => clearTimeout(id)
  }, [state])

  async function copy() {
    try { await navigator.clipboard.writeText(url); setState('copied') } catch { setState('manual') }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <button type="button" className="text-button" onClick={copy}>Copy profile link</button>
      <span className={`text-xs ${state === 'manual' ? 'sr-only' : 'text-[#2f6b47]'}`} role="status">
        {state === 'copied' ? 'Link copied' : state === 'manual' ? "Couldn't copy the link. Copy it from the field below." : ''}
      </span>
      {state === 'manual' && (
        <label className="flex w-full flex-col gap-1 text-xs text-[#5b6a58]">Copy this link
          <input ref={manualInput} readOnly value={url} onFocus={e => e.target.select()} className="min-h-[36px] w-full min-w-0 rounded-lg border border-[#d8dfd1] bg-white px-2 text-sm text-[#173a40]" />
        </label>
      )}
    </span>
  )
}
