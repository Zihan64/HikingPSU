import { useEffect, useState } from 'react'
import { getTrailReviews } from './api'
import { useOptionalToken } from './auth'
import { StarDisplay } from './Stars'
import { CommentItem, SCORE_ROWS } from './Comments'

// Average scores for a trail; `reloadKey` changes after someone submits a review.
export default function Reviews({ trailId, reloadKey }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const getToken = useOptionalToken()  // logged in: your own review is marked "(you)" and your hearts show

  useEffect(() => {
    setError(null)
    getToken().then(token => getTrailReviews(trailId, token)).then(setData).catch(e => setError(e.message))
  }, [trailId, reloadKey, getToken])

  if (error) return <p className="text-sm text-red-700">Couldn't load reviews: {error}</p>
  if (!data) return <p className="text-sm text-stone-500">Loading reviews…</p>
  if (data.summary.count === 0) return <p className="text-sm text-stone-500">No reviews yet. Be the first after you hike it!</p>

  return (
    <div className="space-y-3">
      <div className="grid gap-1 sm:grid-cols-3">
        {SCORE_ROWS.map(([k, label]) => (
          <div key={k} className="text-xs text-stone-600">
            {label}
            <div className="flex items-center gap-1"><StarDisplay value={data.summary[k]} /><span className="font-semibold text-stone-800">{data.summary[k]}</span></div>
          </div>
        ))}
      </div>
      <ul className="space-y-2">
        {data.reviews.map(r => <CommentItem key={r.id} c={r} />)}
      </ul>
    </div>
  )
}
