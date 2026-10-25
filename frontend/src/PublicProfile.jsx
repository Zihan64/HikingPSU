import { useCallback, useEffect, useRef, useState } from 'react'
import { getFollowers, getFollowing, getPublicProfile } from './api'
import { useOptionalToken } from './auth'
import BadgeGrid from './Badges'
import { Avatar, CopyProfileLink, FollowButton, UserCardRow, useFollow } from './People'
import { HANDLE_PATTERN, formatJoined } from './profileLink'

const LIST_PAGE = 50
const LISTS = {
  followers: { title: 'Followers', load: getFollowers, empty: 'No followers yet.' },
  following: { title: 'Following', load: getFollowing, empty: 'Not following anyone yet.' },
}

// One hiker's public page (GET /users/{handle}). onBack returns to the previous view;
// onEditProfile opens your own profile settings when this is you.
export default function PublicProfile({ handle, onBack, onEditProfile }) {
  const getToken = useOptionalToken()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState(null)   // 'missing' or a message
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setProfile(null); setError(null)
    // Not a possible username (e.g. a pasted ?u=alex%2Ffollowers would reach another route): don't ask.
    if (!HANDLE_PATTERN.test(handle)) { setError('missing'); return }
    getToken()
      .then(token => getPublicProfile(handle, token))
      .then(p => { if (!cancelled) setProfile(p) })
      .catch(e => { if (!cancelled) setError(e.status === 404 ? 'missing' : "We couldn't load this profile. Please try again.") })
    return () => { cancelled = true }
  }, [handle, getToken, attempt])

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-6">
      {onBack && <button type="button" className="text-button" onClick={onBack}>← Back</button>}
      {error === 'missing' ? (
        <div className="rounded-2xl border border-dashed border-[#c9d2c2] bg-white/70 p-10 text-center text-sm" role="status">
          <p className="font-semibold">No hiker with that username.</p>
          <p className="mt-1 text-xs text-[#73806e]">Check the link, or search for hikers on the Community page.</p>
        </div>
      ) : error ? (
        <div className="space-y-2">
          <p className="error-message" role="alert">{error}</p>
          <button type="button" className="text-button" onClick={() => setAttempt(n => n + 1)}>Try again</button>
        </div>
      ) : !profile ? (
        <p className="p-6 text-sm text-[#73806e]" role="status">Loading profile…</p>
      ) : <ProfileView key={profile.handle} profile={profile} onEditProfile={onEditProfile} />}
    </div>
  )
}

function CountButton({ value, label, list, open, onToggle }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={`profile-${list}`} onClick={onToggle}
      className={`min-h-[44px] rounded-xl border px-3 text-sm ${open ? 'border-[#2f6b47] bg-[#e6f1df] text-[#2f6b47]' : 'border-[#e0e5dc] bg-white text-[#173a40] hover:border-[#9cc48a]'}`}>
      <b className="tabular-nums">{value}</b> {label}
    </button>
  )
}

function ProfileView({ profile: p, onEditProfile }) {
  const [list, setList] = useState(null)   // 'followers' | 'following' | null
  const [listVersion, setListVersion] = useState(0)
  // Following them changes their followers list; reload it if it's open.
  const follow = useFollow(p, () => setListVersion(v => v + 1))
  // On your own profile, following or unfollowing from the lists changes your following count.
  const [followingCount, setFollowingCount] = useState(p.following_count)
  const onListFollow = p.is_me
    ? (next, before) => setFollowingCount(n => Math.max(0, n + Number(next.following) - Number(Boolean(before.following))))
    : undefined
  const hidden = !p.is_public && !p.is_me
  const joined = formatJoined(p.joined)
  const toggleList = name => setList(open => (open === name ? null : name))
  // The link or row that opened this page is gone; land keyboard and screen-reader users on the name.
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="page-intro flex min-w-0 items-center gap-4">
          <Avatar name={p.display_name} large />
          <div className="min-w-0">
            <span className="eyebrow">{p.is_me ? 'YOUR PUBLIC PROFILE' : 'HIKER PROFILE'}</span>
            <h1 ref={heading} tabIndex={-1} className="mt-1 break-words focus:outline-none text-[clamp(24px,2.3vw,34px)] font-semibold leading-tight tracking-tight">{p.display_name}</h1>
            <p className="text-sm">
              @{p.handle}
              {p.follows_you && !p.is_me && <span className="ml-2 rounded-full bg-[#e6f1df] px-2 py-0.5 text-[11px] font-semibold text-[#2f6b47]">Follows you</span>}
            </p>
            {joined && <p className="text-xs text-[#73806e]">Joined {joined}</p>}
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          {p.is_me
            ? <button type="button" className="primary-button" onClick={onEditProfile}>Edit profile</button>
            : <FollowButton follow={follow} name={p.display_name} large />}
          {follow.notice && <p className="max-w-xs text-xs text-[#9b3e2e]" role="alert">{follow.notice}</p>}
          <CopyProfileLink handle={p.handle} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Followers and following">
        <CountButton value={follow.followers_count} label={follow.followers_count === 1 ? 'follower' : 'followers'} list="followers" open={list === 'followers'} onToggle={() => toggleList('followers')} />
        <CountButton value={followingCount} label="following" list="following" open={list === 'following'} onToggle={() => toggleList('following')} />
      </div>
      {list && <PeopleList key={list} handle={p.handle} kind={list} version={listVersion} onFollowChange={onListFollow} />}

      {hidden ? (
        <div className="rounded-2xl border border-dashed border-[#c9d2c2] bg-white/70 p-8 text-center text-sm" role="status">
          <p className="font-semibold">This profile is private.</p>
          <p className="mt-1 text-xs text-[#73806e]">{p.display_name} keeps their trails and badges to themselves.</p>
        </div>
      ) : (
        <>
          {p.is_me && !p.is_public && (
            <p className="rounded-xl bg-[#f2f4ee] p-3 text-xs text-[#5b6a58]">Your profile is private: other hikers see only your name, username, join date and follower counts.</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[#e0e5dc] bg-white p-3">
              <div className="text-2xl font-bold text-[#2f6b47]">{p.completed_trails}<span className="text-sm font-normal text-[#73806e]"> of {p.total_trails}</span></div>
              <div className="text-xs text-[#73806e]">trails completed with a check-in</div>
            </div>
            <div className="rounded-2xl border border-[#e0e5dc] bg-white p-3">
              <div className="text-2xl font-bold text-[#2f6b47]">{p.badge_count}</div>
              <div className="text-xs text-[#73806e]">{p.badge_count === 1 ? 'badge' : 'badges'} earned</div>
            </div>
          </div>
          <section className="rounded-2xl border border-[#e0e5dc] bg-white p-4">
            <h2 className="text-sm font-semibold">Badges</h2>
            {p.badges.length
              ? <BadgeGrid badges={p.badges} className="mt-3" label={`${p.display_name}'s badges`} />
              : <p className="mt-2 rounded-xl bg-[#f2f4ee] p-3 text-sm text-[#5b6a58]">{p.is_me ? 'Check in at a trailhead and finish with a rating to earn your first badge.' : `${p.display_name} hasn't earned a badge yet.`}</p>}
          </section>
        </>
      )}
    </>
  )
}

// Followers or following, a page at a time. 403: the profile is private and isn't yours.
function PeopleList({ handle, kind, version, onFollowChange }) {
  const getToken = useOptionalToken()
  const { title, load, empty } = LISTS[kind]
  const [items, setItems] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)   // 'private' or a message

  const fetchPage = useCallback(async skip => load(handle, { skip, limit: LIST_PAGE }, await getToken()), [load, handle, getToken])

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchPage(0)
      .then(page => { if (!cancelled) { setItems(page); setHasMore(page.length === LIST_PAGE) } })
      .catch(e => { if (!cancelled) setError(e.status === 403 ? 'private' : "We couldn't load this list. Please try again.") })
    return () => { cancelled = true }
  }, [fetchPage, version])

  async function more() {
    setLoadingMore(true)
    try {
      const page = await fetchPage(items.length)
      setItems(prev => [...prev, ...page.filter(u => !prev.some(x => x.handle === u.handle))]); setHasMore(page.length === LIST_PAGE)
    } catch { setError("We couldn't load more hikers.") }
    finally { setLoadingMore(false) }
  }

  return (
    <section id={`profile-${kind}`} aria-label={title} className="rounded-2xl border border-[#e0e5dc] bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {error === 'private' ? <p className="mt-2 text-sm text-[#5b6a58]" role="status">This hiker's lists are private.</p>
        : error && !items ? <p className="error-message mt-2" role="alert">{error}</p>
          : !items ? <p className="mt-2 text-xs text-[#73806e]" role="status">Loading…</p>
            : items.length === 0 ? <p className="mt-2 text-xs text-[#73806e]">{empty}</p>
              : <ul className="mt-2 space-y-2">{items.map(u => <UserCardRow key={u.handle} user={u} onFollowChange={onFollowChange} />)}</ul>}
      {error && error !== 'private' && items && <p className="error-message mt-2" role="alert">{error}</p>}
      {hasMore && items && <button type="button" className="text-button" onClick={more} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more'}</button>}
    </section>
  )
}
