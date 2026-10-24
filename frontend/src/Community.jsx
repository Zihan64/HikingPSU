import { useCallback, useEffect, useState } from 'react'
import { getCommunityFeed } from './api'
import { useOptionalToken } from './auth'
import { CommentItem } from './Comments'

const PAGE = 20
const SORTS = [['recent', 'Newest'], ['top', 'Most loved']]
const selectCls = 'min-h-[40px] w-full rounded-lg border border-[#d8dfd1] bg-white px-2 py-1.5 text-sm'

// Hikers' feedback across every trail. `onReview(trail)` opens the review form;
// `reloadKey` changes after a review is saved so the feed picks it up.
export default function Community({ trails, onReview, reloadKey }) {
  const getToken = useOptionalToken()
  const [sort, setSort] = useState('recent')
  const [trailId, setTrailId] = useState('')
  const [shareId, setShareId] = useState('')
  const [items, setItems] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  const fetchPage = useCallback(async skip =>
    getCommunityFeed({ sort, trailId, limit: PAGE, skip }, await getToken()), [sort, trailId, getToken])

  useEffect(() => {
    let cancelled = false
    setItems(null); setError(null)
    fetchPage(0)
      .then(page => { if (!cancelled) { setItems(page); setHasMore(page.length === PAGE) } })
      .catch(() => { if (!cancelled) setError("We couldn't load community posts. Please try again.") })
    return () => { cancelled = true }
  }, [fetchPage, reloadKey])

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
      <div>
        <span className="eyebrow">COMMUNITY</span>
        <h1 className="mt-2 text-[clamp(24px,2.3vw,34px)] font-semibold leading-tight tracking-tight">Trail talk</h1>
        <p className="mt-2 text-[13px] text-[#73806e]">See how other hikers found the trails, share your own hike, and heart the comments you find helpful.</p>
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
          {trailId ? 'No one has reviewed this trail yet.' : 'No hiker reviews yet.'} Be the first to share how it went!
        </div>
      )}
      {items?.length > 0 && <ul className="space-y-2" aria-label="Community posts">{items.map(c => <CommentItem key={c.id} c={c} showTrail />)}</ul>}
      {hasMore && <button className="text-button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more posts'}</button>}
    </div>
  )
}
