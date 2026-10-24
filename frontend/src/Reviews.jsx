import { useEffect, useState } from 'react'
import { getTrailReviews } from './api'
import { useOptionalToken } from './auth'
import { StarDisplay } from './Stars'

// Mongo hands back naive UTC timestamps; without a zone the browser would read them as local time.
const asUtc = iso => new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`)

const ROWS = [['accuracy', 'Info accuracy'], ['difficulty', 'Felt difficulty'], ['enjoyment', 'Enjoyment']]

// Average scores for a trail; `reloadKey` changes after someone submits a review.
export default function Reviews({ trailId, reloadKey }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const getToken = useOptionalToken()  // logged in: your own review is marked "(you)"

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
        {ROWS.map(([k, label]) => (
          <div key={k} className="text-xs text-stone-600">
            {label}
            <div className="flex items-center gap-1"><StarDisplay value={data.summary[k]} /><span className="font-semibold text-stone-800">{data.summary[k]}</span></div>
          </div>
        ))}
      </div>
      <ul className="space-y-2">
        {data.reviews.map(r => (
          <li key={r.id} className="rounded-lg bg-stone-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-stone-500">
              <span className="font-semibold text-stone-700">{r.author}{r.mine && ' (you)'}</span>
              <time dateTime={r.created_at}>{asUtc(r.created_at).toLocaleDateString()}</time>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-stone-600">
              {ROWS.map(([k, label]) => <span key={k}>{label} <StarDisplay value={r[k]} /></span>)}
            </div>
            {r.comment && <p className="mt-2 whitespace-pre-wrap text-stone-700">{r.comment}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
