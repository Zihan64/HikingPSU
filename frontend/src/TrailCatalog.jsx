import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { listParks, getTrailGeometry } from './api'
import { filterCatalog, formatTime, routeType } from './catalogFilter'
import { LEVEL_HEX, LEVEL_LABELS } from './levels'
import { StarDisplay } from './Stars'
import Reviews from './Reviews'
import TrailMap from './TrailMap'
import ElevationProfile from './ElevationProfile'
import CheckinControl from './CheckinControl'

function Level({trail}) {
  return <span className="catalog-level" style={{color:LEVEL_HEX[trail.difficulty.level]}}>L{trail.difficulty.level} · {LEVEL_LABELS[trail.difficulty.level]}</span>
}

function TrailDetail({trail, park, backLabel, summary, onBack, onReview, reviewsVersion, onOfficialArea, checkin, onCheckinChange, onCheckinRefresh, onFinishCheckin, active = true}) {
  const [data, setData] = useState(null), [state, setState] = useState('loading'), [retry, setRetry] = useState(0)
  const heading = useRef(null), article = useRef(null), scrollTop = useRef(0)
  useEffect(() => { heading.current?.focus({preventScroll:true}) }, [])
  // Kept (hidden) behind a hiker's profile: back on screen, return to where the reader was.
  useLayoutEffect(() => { if (active && article.current) article.current.scrollTop = scrollTop.current }, [active])
  useEffect(() => {
    const controller = new AbortController()
    setState('loading'); setData(null)
    getTrailGeometry(trail.id, controller.signal).then(result => {if (!controller.signal.aborted) {setData(result); setState('ready')}})
      .catch(error => {if (!controller.signal.aborted) setState(error.status === 404 ? 'missing' : 'error')})
    return () => controller.abort()
  }, [trail.id, retry])
  const official = park?.official_area_id
  const access = trail.access
  return <article className="catalog-detail" ref={article} onScroll={e => { if (active) scrollTop.current = e.currentTarget.scrollTop }}>
    <button className="text-button" onClick={onBack}>← Back to {backLabel}</button>
    <header><span className="eyebrow">YOUR NEXT TRAIL</span><h1 ref={heading} tabIndex={-1}>{trail.name}</h1><p>{trail.park_name || 'Other nearby trails'} · {trail.area}</p><Level trail={trail} />
      {!trail.verified && <p className="catalog-muted">Planning estimate · not an official navigation itinerary</p>}
    </header>
    <dl className="catalog-stats"><div><dt>Length</dt><dd>{trail.distance_mi} mi</dd></div><div><dt>Elevation gain</dt><dd>{trail.elevation_gain_ft.toLocaleString()} ft</dd></div><div><dt>Estimated time</dt><dd>{formatTime(trail.difficulty.est_time_min)}</dd></div><div><dt>Route type</dt><dd>{routeType(trail)}</dd></div></dl>
    <div className="catalog-detail-columns"><div>
      <section className="catalog-section"><h2>Trail map</h2><TrailMap trail={trail} geometry={data} />
        {state === 'loading' && <p role="status">Loading route line…</p>}
        {state === 'missing' && <p className="catalog-muted">Route line not available yet. The marker shows the trailhead.</p>}
        {state === 'error' && <p role="alert">Couldn't load the route line. <button className="text-button" onClick={() => setRetry(n => n+1)}>Retry</button></p>}
        {data && <p className="catalog-muted">Route geometry: <a href={`https://www.openstreetmap.org/relation/${data.osm_relation}`} target="_blank" rel="noopener noreferrer">OpenStreetMap contributors ↗</a> · not manager-certified; check current signs and closures.</p>}
      </section>
      <ElevationProfile profile={data?.profile} />
      {data?.profile?.length > 1 && trail.source === 'osm' && !trail.loop && <p className="catalog-muted">The profile follows the mapped line once. Length, elevation gain and time above include the return journey.</p>}
      <CheckinControl trail={trail} checkin={checkin} onChange={onCheckinChange} onRefresh={onCheckinRefresh} onFinish={onFinishCheckin} />
      <section className="catalog-section"><h2>Reviews {summary?.count ? `(${summary.count})` : ''}</h2><button className="primary-button" onClick={() => onReview(trail)}>✓ I finished this trail</button><Reviews trailId={trail.id} reloadKey={reviewsVersion} /></section>
    </div><div>
      <section className="catalog-section"><h2>Why this level</h2><Level trail={trail} /><ul>{trail.difficulty.reasons.map((reason,i) => <li key={i}>{reason}</li>)}</ul><p className="catalog-muted">{Object.entries(LEVEL_LABELS).map(([level,label]) => `L${level} ${label}`).join(' · ')}</p></section>
      <section className="catalog-section"><h2>Getting there</h2><p>{trail.trailhead.address}</p><ul>
        {trail.car_free && <li>Car-free access available</li>}{access.bus && <li>Bus: {access.bus}</li>}
        {access.walk_from_campus_min != null && <li>Walk from campus: {access.walk_from_campus_min} min</li>}
        {access.bike_min != null && <li>Bike from campus: {access.bike_min} min</li>}
        {access.drive_min != null && <li>Drive from campus: {access.drive_min} min</li>}
        <li>Parking: {trail.parking || 'No parking details available'}</li><li>Cell signal: {trail.cell_signal}</li>
      </ul>{trail.hunting_zone && <p className="catalog-warning">Hunting zone · check seasonal rules and wear visible colors.</p>}
        <div className="catalog-chips">{[...trail.best_seasons, ...trail.features].map((label,i) => <span key={i}>{label}</span>)}</div>
        <p className="catalog-muted">{trail.notes}</p>
        {official && <button className="text-button" onClick={() => onOfficialArea(official)}>Official maps & route sources →</button>}
      </section>
    </div></div>
  </article>
}

// checkin/onCheckin*/onFinishCheckin: the signed-in user's active trailhead check-in (owned by App).
// openTrail {id}: a new object opens that trail's detail page (e.g. "View trail" in the check-in banner).
// kept: hidden behind a hiker's profile opened from here; stay rendered so Back finds the page as it was.
export default function TrailCatalog({trails, summaries, onReview, reviewsVersion, onOfficialResources, onOfficialArea, active, kept = false, loading, loadError, checkin = null, onCheckinChange, onCheckinRefresh, onFinishCheckin, openTrail = null}) {
  const [parks, setParks] = useState([]), [parkError, setParkError] = useState(null), [retry, setRetry] = useState(0)
  const [parkId, setParkId] = useState('all'), [query, setQuery] = useState(''), [sort, setSort] = useState('name')
  const [selectedId, setSelectedId] = useState(null)
  const list = useRef(null), scroll = useRef(0), lastSelected = useRef(null), listShown = useRef(false)
  useEffect(() => {
    if (!openTrail?.id) return
    // Keep the position from the user's last look at the list: when the catalog was just opened by this
    // same render, the fresh list is at the top. The row wasn't clicked, so don't focus it on Back.
    if (listShown.current && list.current) scroll.current = list.current.scrollTop
    lastSelected.current = null; setSelectedId(openTrail.id)
  }, [openTrail])
  useEffect(() => {
    if (!active || parks.length) return
    const controller = new AbortController()
    setParkError(null)
    listParks(controller.signal).then(result => { if (!controller.signal.aborted) setParks(result) })
      .catch(() => {if (!controller.signal.aborted) setParkError('Park filters are temporarily unavailable.')})
    return () => controller.abort()
  }, [active, parks.length, retry])
  const visible = useMemo(() => filterCatalog(trails, {parkId, query, sort}), [trails, parkId, query, sort])
  const park = parks.find(p => p.id === parkId)
  const selected = trails.find(t => t.id === selectedId)
  useEffect(() => {
    if (selectedId || !active) return
    const frame = requestAnimationFrame(() => {
      if (list.current) {
        list.current.scrollTop = scroll.current
        if (lastSelected.current) list.current.querySelector(`[data-trail-id="${lastSelected.current}"]`)?.focus({preventScroll:true})
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId, active])
  useEffect(() => { listShown.current = active && !selectedId })
  function selectPark(id) { setParkId(id); scroll.current = 0; list.current?.scrollTo({top:0}) }
  if (!active && !kept) return null
  return <section className="trail-catalog" aria-label="Trail catalog">
    {selected ? <TrailDetail key={selected.id} trail={selected} park={parks.find(p => p.id === selected.park_id)} backLabel={park?.name || 'All trails'} summary={summaries[selected.id]} onBack={() => setSelectedId(null)} onReview={onReview} reviewsVersion={reviewsVersion} onOfficialArea={onOfficialArea} active={active}
      checkin={checkin} onCheckinChange={onCheckinChange} onCheckinRefresh={onCheckinRefresh} onFinishCheckin={onFinishCheckin} /> : <>
      <header className="catalog-intro"><span className="eyebrow">FIND YOUR NEXT OUTING</span><h1>Trails</h1><p>Explore local trails, one park at a time.</p></header>
      <div className="catalog-columns">
        <section className="catalog-results" aria-label="Searchable trail list">
          <form className="catalog-search" onSubmit={e => e.preventDefault()}><label>Find a trail<input type="search" value={query} onChange={e => {setQuery(e.target.value); scroll.current = 0; list.current?.scrollTo({top:0})}} placeholder="Trail, park, town or feature…" /></label>
            <label>Sort by<select value={sort} onChange={e => {setSort(e.target.value); scroll.current = 0; list.current?.scrollTo({top:0})}}><option value="name">Name</option><option value="difficulty">Difficulty</option><option value="distance">Trail length</option></select></label>
            <p role="status">{visible.length} trail{visible.length === 1 ? '' : 's'}{park ? ` in ${park.name}` : ' in all parks'}</p>
          </form>
          <div className="catalog-list" ref={list} onScroll={e => {scroll.current = e.currentTarget.scrollTop}}>
            {loading && <p className="empty-state" role="status">Waking up the trail server…</p>}
            {loadError && <p className="error-message" role="alert">{loadError}</p>}
            {visible.map(t => <button key={t.id} type="button" data-trail-id={t.id} className="catalog-row" onClick={() => {scroll.current = list.current.scrollTop; lastSelected.current = t.id; setSelectedId(t.id)}}>
              <div className="catalog-row-title"><h2>{t.name}</h2><Level trail={t} /></div><p>{t.park_name || 'Other nearby trails'} · {t.area}</p>
              <p>{t.distance_mi} mi · {t.elevation_gain_ft} ft gain · {formatTime(t.difficulty.est_time_min)}</p>
              <span className="catalog-rating">{summaries[t.id]?.count ? <><StarDisplay value={summaries[t.id].enjoyment} />{summaries[t.id].enjoyment} ({summaries[t.id].count} reviews)</> : 'No reviews yet'}<span aria-hidden="true">↗</span></span>
            </button>)}
            {!loading && !loadError && !visible.length && <div className="empty-state">No trails match this search.<button className="text-button" onClick={() => {setQuery(''); selectPark('all')}}>Clear search & filters</button></div>}
          </div>
        </section>
        <aside className="catalog-parks" aria-label="Choose a park"><h2>Parks & managed areas</h2>
          {parkError && <p role="alert">{parkError}<button className="text-button" onClick={() => setRetry(n => n+1)}>Retry parks</button></p>}
          <div className="catalog-park-list">{[{id:'all',name:'All parks',trail_count:trails.length},...parks].map(p => <div key={p.id} className={`catalog-park ${parkId === p.id ? 'is-selected' : ''}`}>
            <button type="button" onClick={() => selectPark(p.id)} aria-pressed={parkId === p.id}><span>{p.name}<small>{p.manager}</small></span><b>{p.trail_count}</b></button>
            {p.official_area_id && <button className="text-button" onClick={() => onOfficialArea(p.official_area_id)}>Official maps for this park →</button>}
          </div>)}</div>
        </aside>
      </div>
    </>}
  </section>
}
