import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { getCommunityFeed, getFollowingActivity, searchUsers } from './api'
import { AUTH_ENABLED, useOptionalToken } from './auth'
import { CommentItem } from './Comments'
import { BadgeEmoji } from './Badges'
import { plural } from './checkin'
import { ProfileName, UserCardRow } from './People'

const PAGE = 20
const FEED_MAX = 50   // the server's largest page
const SORTS = [['recent', 'Newest'], ['top', 'Most loved']]
const selectCls = 'min-h-[40px] w-full rounded-lg border border-[#d8dfd1] bg-white px-2 py-1.5 text-sm'
const SEARCH_DELAY_MS = 300
const SEARCH_MIN = 2
const ACTIVITY_SHOWN = 5

// People search (GET /users?q=). Waits for a pause in typing and at least two characters;
// a newer query cancels the one in flight. onFollowChange runs after a follow from the results.
// active: false while the page is hidden behind a profile; becoming active again refreshes the results.
export function FindHikers({ onFollowChange, active = true }) {
  const getToken = useOptionalToken()
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)   // null: nothing searched yet
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const query = q.trim().replace(/^@/, '').trim()   // '@ jo' -> 'jo': the server trims too before its 2-30 rule

  useEffect(() => {
    if (!active) return
    setError(null)
    if (query.length < SEARCH_MIN) { setResults(null); setSearching(false); return }
    const abort = new AbortController()
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const found = await searchUsers(query, await getToken(), abort.signal)
        if (!abort.signal.aborted) setResults(found)
      } catch {
        if (!abort.signal.aborted) { setResults(null); setError("We couldn't search for hikers. Please try again.") }
      } finally { if (!abort.signal.aborted) setSearching(false) }
    }, SEARCH_DELAY_MS)
    return () => { clearTimeout(timer); abort.abort(); setSearching(false) }
  }, [query, getToken, active])

  return (
    <section className="rounded-2xl border border-[#e0e5dc] bg-white p-4" aria-labelledby="find-hikers-title">
      <h2 id="find-hikers-title" className="text-sm font-semibold">Find hikers</h2>
      <p className="mb-2 text-xs text-[#73806e]">Search by name or @username to see their badges and follow them.</p>
      <label className="sr-only" htmlFor="find-hikers">Search hikers</label>
      <input id="find-hikers" type="search" className={selectCls} value={q} onChange={e => setQ(e.target.value)} maxLength={30}
        placeholder="Name or @username" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" />
      <div className="mt-2" role="status">
        {query.length > 0 && query.length < SEARCH_MIN && <p className="text-xs text-[#73806e]">Type at least {SEARCH_MIN} characters.</p>}
        {searching && <p className="text-xs text-[#73806e]">Searching…</p>}
        {!searching && results?.length === 0 && <p className="text-sm text-[#5b6a58]">No hikers match.</p>}
        {!searching && results?.length > 0 && <span className="sr-only">{plural(results.length, 'hiker')} found</span>}
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {results?.length > 0 && <ul className="mt-1 space-y-2" aria-label="Hikers found">{results.map(u => <UserCardRow key={u.handle} user={u} onFollowChange={onFollowChange} />)}</ul>}
    </section>
  )
}

// Signed in only: badges recently earned by the public profiles you follow (GET /me/following/activity).
export function FollowingActivity({ reloadKey = 0, active = true }) {
  const getToken = useOptionalToken()
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setError(null)
    getToken()
      .then(token => getFollowingActivity(token))
      .then(list => { if (!cancelled) setItems(list) })
      .catch(() => { if (!cancelled) setError("We couldn't load recent badges from people you follow.") })
    return () => { cancelled = true }
  }, [getToken, reloadKey, active])

  const shown = showAll ? items : items?.slice(0, ACTIVITY_SHOWN)
  return (
    <section className="rounded-2xl border border-[#e0e5dc] bg-white p-4" aria-labelledby="following-activity-title">
      <h2 id="following-activity-title" className="text-sm font-semibold">From people you follow</h2>
      {error && <p className="error-message mt-2" role="alert">{error}</p>}
      {!items && !error && <p className="mt-2 text-xs text-[#73806e]" role="status">Loading…</p>}
      {items?.length === 0 && <p className="mt-2 rounded-xl bg-[#f2f4ee] p-3 text-sm text-[#5b6a58]">Follow hikers to see the badges they earn here.</p>}
      {items?.length > 0 && (
        <ul className="mt-2 divide-y divide-[#eef1e9]" aria-label="Badges earned by people you follow">
          {shown.map(({ user, badge }) => (
            <li key={`${user.handle}:${badge.key}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
              <span className="min-w-0">
                <ProfileName handle={user.handle} plain="font-semibold">{user.display_name}</ProfileName>
                {' earned '}<BadgeEmoji badge={badge} /> <b className="font-medium">{badge.title}</b>
              </span>
              <time className="text-xs text-[#73806e]" dateTime={badge.awarded_at}>{new Date(badge.awarded_at).toLocaleDateString()}</time>
            </li>
          ))}
        </ul>
      )}
      {items?.length > ACTIVITY_SHOWN && <button type="button" className="text-button" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${items.length}`}</button>}
    </section>
  )
}

// Hikers' feedback across every trail. `onReview(trail)` opens the review form;
// `reloadKey` changes after a review is saved so the feed picks it up. `active` is false while
// the page stays mounted behind a hiker's profile; the people sections refresh when it returns.
export default function Community({ trails, onReview, reloadKey, active = true }) {
  const getToken = useOptionalToken()
  const { isAuthenticated } = useAuth0()
  const signedIn = AUTH_ENABLED && isAuthenticated
  const [followsVersion, setFollowsVersion] = useState(0)   // a follow from search refreshes the activity list
  const [sort, setSort] = useState('recent')
  const [trailId, setTrailId] = useState('')
  const [shareId, setShareId] = useState('')
  const [items, setItems] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  const fetchPage = useCallback(async skip =>
    getCommunityFeed({ sort, trailId, limit: PAGE, skip }, await getToken()), [sort, trailId, getToken])
  // The first `count` posts, a server page at a time.
  const fetchFirst = useCallback(async count => {
    const token = await getToken()
    const list = []
    while (list.length < count) {
      const limit = Math.min(FEED_MAX, count - list.length)
      const page = await getCommunityFeed({ sort, trailId, limit, skip: list.length }, token)
      list.push(...page.filter(p => !list.some(x => x.id === p.id)))
      if (page.length < limit) break
    }
    return list
  }, [sort, trailId, getToken])

  const itemsRef = useRef(items)
  itemsRef.current = items
  const shownQuery = useRef(null)
  useEffect(() => {
    let cancelled = false
    const query = `${sort}|${trailId}|${reloadKey}`
    // Same posts for a new viewer (signing in, e.g. from a profile opened here): refresh them in place,
    // every page already shown, so the rows stay mounted and Back can return to the one that was opened.
    const refresh = shownQuery.current === query && itemsRef.current !== null
    shownQuery.current = query
    const count = refresh ? Math.max(PAGE, itemsRef.current.length) : PAGE
    setError(null)
    if (!refresh) setItems(null)
    fetchFirst(count)
      // A refresh that comes back full can't tell whether more exist; keep what the last page said.
      .then(list => { if (!cancelled) { setItems(list); setHasMore(more => (refresh ? more && list.length === count : list.length === count)) } })
      .catch(() => { if (!cancelled && !refresh) setError("We couldn't load community posts. Please try again.") })
    return () => { cancelled = true }
  }, [fetchFirst, sort, trailId, reloadKey])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const page = await fetchPage(items.length)
      setItems(prev => [...prev, ...page.filter(p => !prev.some(x => x.id === p.id))]); setHasMore(page.length === PAGE)
    } catch { setError("We couldn't load more posts.") }
    finally { setLoadingMore(false) }
  }

  const shareTrail = trails.find(t => t.id === shareId)
  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-6">
      <div className="page-intro">
        <span className="eyebrow">COMMUNITY</span>
        <h1 className="mt-2 text-[clamp(24px,2.3vw,34px)] font-semibold leading-tight tracking-tight">Trail talk</h1>
        <p className="mt-2 text-[13px] text-[#73806e]">See how other hikers found the trails, share your own hike, follow other hikers and heart the comments you find helpful.</p>
      </div>

      <section className="rounded-2xl border border-[#e0e5dc] bg-white p-4">
        <h2 className="text-sm font-semibold">Share your hike</h2>
        <p className="mb-2 text-xs text-[#73806e]">Rate the trail and leave a comment for the next hiker.</p>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); if (shareTrail) onReview(shareTrail) }}>
          <label className="sr-only" htmlFor="share-trail">Trail you hiked</label>
          <select id="share-trail" className={selectCls} value={shareId} onChange={e => setShareId(e.target.value)}>
            <option value="">Which trail did you hike?</option>
            {trails.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="primary-button shrink-0" disabled={!shareTrail}>Write a review</button>
        </form>
      </section>

      <FindHikers active={active} onFollowChange={() => setFollowsVersion(v => v + 1)} />
      {signedIn && <FollowingActivity active={active} reloadKey={followsVersion} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 self-start rounded-xl bg-[#e6eee0] p-1" role="group" aria-label="Sort posts">
          {SORTS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}
              className={`min-h-[36px] rounded-lg px-3 text-xs ${sort === key ? 'bg-white text-[#2f6b47] shadow-sm' : 'text-[#4f6466]'}`}>{label}</button>
          ))}
        </div>
        <div className="sm:w-72">
          <label className="sr-only" htmlFor="feed-trail">Filter by trail</label>
          <select id="feed-trail" className={selectCls} value={trailId} onChange={e => setTrailId(e.target.value)}>
            <option value="">All trails</option>
            {trails.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="error-message" role="alert">{error}</p>}
      {!items && !error && <p className="p-6 text-sm text-[#73806e]" role="status">Loading posts…</p>}
      {items?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#c9d2c2] p-10 text-center text-sm" role="status">
          {trailId ? 'No one has commented on this trail yet.' : 'No hiker comments yet.'} Be the first to share how it went!
        </div>
      )}
      {items?.length > 0 && <ul className="space-y-2" aria-label="Community posts">{items.map(c => <CommentItem key={c.id} c={c} showTrail />)}</ul>}
      {hasMore && <button className="text-button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more posts'}</button>}
    </div>
  )
}
