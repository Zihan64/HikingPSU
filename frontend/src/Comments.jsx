import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { setCommentLike } from './api'
import { AUTH_ENABLED, useOptionalToken } from './auth'
import { StarDisplay } from './Stars'

// Mongo hands back naive UTC timestamps; without a zone the browser would read them as local time.
export const asUtc = iso => new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`)

export const SCORE_ROWS = [['accuracy', 'Info accuracy'], ['difficulty', 'Felt difficulty'], ['enjoyment', 'Enjoyment']]

// Heart toggle for a review or starter tip. Updates at once and rolls back if the server refuses.
export function HeartButton({ comment, size = 'sm' }) {
  const { isAuthenticated, loginWithPopup } = useAuth0()
  const getToken = useOptionalToken()
  const [state, setState] = useState({ likes: comment.likes, liked: comment.liked })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  useEffect(() => { setState({ likes: comment.likes, liked: comment.liked }) }, [comment.id, comment.likes, comment.liked])

  async function toggle(e) {
    e.stopPropagation()
    if (!AUTH_ENABLED) { setNotice('Sign-in is unavailable in this preview.'); return }
    if (!isAuthenticated) { loginWithPopup(); return }
    if (busy) return
    const before = state
    const liked = !state.liked
    setBusy(true); setNotice(null)
    setState({ liked, likes: state.likes + (liked ? 1 : -1) })
    try { setState(await setCommentLike(comment.id, liked, await getToken())) }
    catch { setState(before); setNotice("Couldn't save your heart. Try again.") }
    finally { setBusy(false) }
  }

  const label = `${state.liked ? 'Remove heart from' : 'Heart'} ${comment.author}'s comment`
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={toggle} aria-pressed={state.liked} aria-label={label} title={isAuthenticated ? undefined : 'Log in to heart comments'}
        className={`inline-flex min-h-[32px] items-center gap-1 rounded-full border px-2.5 tabular-nums transition-colors ${size === 'xs' ? 'text-xs' : 'text-sm'} ${state.liked ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-[#e0e5dc] bg-white text-[#73806e] hover:border-rose-200 hover:text-rose-500'}`}>
        <span aria-hidden="true">{state.liked ? '♥' : '♡'}</span>{state.likes}
      </button>
      {notice && <span className="text-xs text-[#73806e]" role="status">{notice}</span>}
    </span>
  )
}

// One review or tip. `showTrail` names the trail (feeds that mix trails); `compact` is for trail cards.
export function CommentItem({ c, showTrail = false, compact = false }) {
  return (
    <li className={`rounded-lg ${compact ? 'bg-[#f5f7f2] p-2.5' : 'bg-stone-50 p-3'} text-sm`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-stone-500">
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold text-stone-700">{c.author}{c.mine && ' (you)'}</span>
          {c.tip && <span className="rounded-full bg-[#e6f1df] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2f6b47]">Trail tip</span>}
          {showTrail && c.trail_name && <span>on <span className="font-medium text-stone-700">{c.trail_name}</span></span>}
        </span>
        {!c.tip && <time dateTime={c.created_at}>{asUtc(c.created_at).toLocaleDateString()}</time>}
      </div>
      {!compact && !c.tip && (
        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-stone-600">
          {SCORE_ROWS.map(([k, label]) => <span key={k}>{label} <StarDisplay value={c[k]} /></span>)}
        </div>
      )}
      {c.comment && <p className={`mt-1.5 whitespace-pre-wrap text-stone-700 ${compact ? 'line-clamp-3' : ''}`}>{c.comment}</p>}
      <div className="mt-2"><HeartButton comment={c} size={compact ? 'xs' : 'sm'} /></div>
    </li>
  )
}
