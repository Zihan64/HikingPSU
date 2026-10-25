import { useState } from 'react'
import Reviews from './Reviews'
import { StarDisplay } from './Stars'
import { CommentItem } from './Comments'

const LEVEL_COLORS = {
  1: 'bg-emerald-100 text-emerald-800',
  2: 'bg-lime-100 text-lime-800',
  3: 'bg-amber-100 text-amber-800',
  4: 'bg-orange-100 text-orange-800',
  5: 'bg-red-100 text-red-800',
}

// fit: this trail's entry from /me/recommendations, when it is in the signed-in user's ranking.
// highlights: the trail's top community comments (most hearted first).
// onOpenDetails: opens the trail's detail page (Trails tab).
export default function TrailCard({ t, selected = false, onSelect, onOpenDetails, onOfficialResources, summary, onReview, reviewsVersion = 0, fit = null, proximityMeters = null, highlights = [] }) {
  const [showReviews, setShowReviews] = useState(false)
  const d = t.difficulty
  const access = t.access.bus || (t.access.walk_from_campus_min != null ? `${t.access.walk_from_campus_min} min walk` : `${t.access.drive_min} min drive`)
  return (
    <article
      id={`trail-${t.id}`}
      tabIndex={-1}
      onClick={onSelect}
      className={`trail-card rounded-xl border bg-white p-4 shadow-sm ${onSelect ? 'cursor-pointer hover:border-stone-400' : ''} ${selected ? 'border-stone-800 ring-1 ring-stone-800' : 'border-stone-200'}`}
    >
      <button type="button" className="trail-select flex w-full items-start justify-between gap-3 text-left"
        aria-label={`View ${t.name} on map`} aria-pressed={selected}
        onClick={e => { e.stopPropagation(); onSelect?.() }}>
        <div>
          <h3 className="font-semibold">{t.name}</h3>
          <p className="text-sm text-stone-500">{t.area}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${LEVEL_COLORS[d.level]}`}>
          L{d.level} · {d.label}
        </span>
      </button>
      <p className="mt-2 text-sm text-stone-700">
        {t.distance_mi} mi · {t.elevation_gain_ft} ft gain · ~{Math.round(d.est_time_min / 60 * 10) / 10} h
      </p>
      <ul className="mt-2 list-disc pl-5 text-sm text-stone-600">
        {d.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      {fit && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
          <b>Fits you</b> · ~{Math.round(fit.personal_time_min / 60 * 10) / 10} h at your pace · {fit.reasons.join(' · ')}
        </p>
      )}
      {highlights.length > 0 && (
        <section className="mt-3" aria-label={`What hikers say about ${t.name}`} onClick={e => e.stopPropagation()}>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#3e7b52]">What hikers say</h4>
          <ul className="space-y-1.5">{highlights.map(c => <CommentItem key={c.id} c={c} compact />)}</ul>
        </section>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {proximityMeters !== null && <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-800">≈ {(proximityMeters / 1609.344).toFixed(1)} mi to trailhead · straight line</span>}
        <span className={`rounded px-2 py-0.5 ${t.car_free ? 'bg-sky-100 text-sky-800' : 'bg-stone-100 text-stone-600'}`}>
          {t.car_free ? '🚌 ' : '🚗 '}{access}
        </span>
        {t.hunting_zone && <span className="rounded bg-orange-100 px-2 py-0.5 text-orange-800">🟠 hunting zone</span>}
        {t.cell_signal !== 'good' && <span className="rounded bg-stone-100 px-2 py-0.5 text-stone-600">📶 {t.cell_signal}</span>}
      </div>
      {onOpenDetails && (
        <button type="button" onClick={e => { e.stopPropagation(); onOpenDetails() }}
          aria-label={`Open trail details for ${t.name}`}
          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-trail-forest px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
          View trail details →
        </button>
      )}
      {onReview && (
        <div className="mt-3 border-t border-stone-100 pt-3" onClick={e => e.stopPropagation()}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button onClick={() => setShowReviews(v => !v)} aria-expanded={showReviews} className="flex items-center gap-2 text-sm text-stone-700 hover:text-stone-900">
              {summary?.count ? (
                <>
                  <StarDisplay value={summary.enjoyment} />
                  <span className="font-semibold">{summary.enjoyment}</span>
                  <span className="text-stone-500">· {summary.count} review{summary.count === 1 ? '' : 's'}</span>
                </>
              ) : <span className="text-stone-500">No reviews yet</span>}
              <span className="text-xs text-trail-sky underline">{showReviews ? 'Hide' : 'Show'}</span>
            </button>
            <button onClick={onReview} className="rounded-lg border border-trail-forest px-3 py-1 text-xs font-semibold text-trail-forest hover:bg-trail-sage">
              ✓ I finished this trail
            </button>
          </div>
          {showReviews && <div className="mt-3"><Reviews trailId={t.id} reloadKey={reviewsVersion} /></div>}
        </div>
      )}
      {!t.verified && <p className="seed-data-note">{t.source === 'osm'
        ? 'Estimated from OpenStreetMap · distance and climb are approximate, not checked in the field.'
        : 'Planning estimate · not an official navigation itinerary.'}</p>}
      {onOfficialResources && <button className="text-button" onClick={e => { e.stopPropagation(); onOfficialResources() }}>Official maps & route sources →</button>}
    </article>
  )
}
