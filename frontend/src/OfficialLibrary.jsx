import { useEffect, useRef, useState } from 'react'
import { getOfficialLibrary, getOfficialTrails, getOfficialGeometry } from './api'
import { prepareRouteReference } from './trailGeometry'

export function OfficialLinks({ resources = [] }) {
  return <div className="official-links">{resources.map(resource => <a key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer">{resource.kind === 'pdf' ? '↗ PDF / download at publisher' : '↗ Official maps & information'}<span>{resource.title}</span></a>)}</div>
}

export default function OfficialLibrary({ active, trailId, initialAreaId, onOpenRoute }) {
  const [areas, setAreas] = useState([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [activity, setActivity] = useState('hiking')
  const [areaId, setAreaId] = useState('whipple-dam')
  const [trails, setTrails] = useState([])
  const [trailQuery, setTrailQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(null)
  const [error, setError] = useState(null)
  const [indexError, setIndexError] = useState(null)
  const [retrieved, setRetrieved] = useState(null)
  const [retry, setRetry] = useState(0)
  const geometryRequest = useRef(null)
  const routeSection = useRef(null)
  const area = areas.find(item => item.id === areaId)

  useEffect(() => {
    if (active && initialAreaId && areas.some(item => item.id === initialAreaId)) {
      setAreaId(initialAreaId); setQuery(''); setTrailQuery('')
    }
  }, [areas, initialAreaId, active])

  useEffect(() => {
    const match = areas.find(item => item.trail_ids?.includes(trailId))
    if (match) { setAreaId(match.id); setQuery(''); setTrailQuery('') }
  }, [areas, trailId, active])

  useEffect(() => {
    if (!active || areas.length) return
    const controller = new AbortController()
    getOfficialLibrary({}, controller.signal).then(result => { if (!controller.signal.aborted) { setAreas(result.areas); setIndexError(null) } })
      .catch(err => { if (!controller.signal.aborted) setIndexError(err.message) })
    return () => controller.abort()
  }, [active, areas.length, retry])

  useEffect(() => {
    geometryRequest.current?.abort()
    setOpening(null); setTrails([]); setError(null); setRetrieved(null)
    if (!active || !area?.geometry_available) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    getOfficialTrails(area.id, activity, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setTrails(result.trails); setRetrieved(result.retrieved_at) } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, area, activity, retry])

  useEffect(() => () => geometryRequest.current?.abort(), [])

  async function openTrail(trail) {
    geometryRequest.current?.abort()
    const controller = new AbortController()
    geometryRequest.current = controller
    setOpening(trail.id); setError(null)
    try {
      const result = await getOfficialGeometry(areaId, trail.id, activity, controller.signal)
      if (controller.signal.aborted) return
      prepareRouteReference(result.geojson) // Validate before replacing the active map.
      onOpenRoute(result)
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message)
    } finally { if (!controller.signal.aborted) setOpening(null) }
  }

  const tokens = query.toLowerCase().split(/\s+/).filter(word => !['pdf', 'offline', 'map', 'maps', '离线', '地图'].includes(word))
  const pdfOnly = kind === 'pdf' || query.toLowerCase().includes('pdf')
  const visibleAreas = areas.filter(item => item.activities.includes(activity)
    && tokens.every(word => JSON.stringify(item).toLowerCase().includes(word))
    && (!pdfOnly || item.resources.some(r => r.kind === 'pdf')))
  const visibleTrails = trails.filter(trail => trail.name.toLowerCase().includes(trailQuery.toLowerCase()))

  return <section className="official-library" aria-labelledby="library-title">
    <header className="library-intro"><span className="eyebrow">FROM THE PEOPLE WHO MANAGE THE TRAILS</span><h1 id="library-title">Official trail library</h1><p>Find manager-published routes and original maps. Files stay with their publishers.</p><p className="library-coverage">Pilot: State College / Rothrock and nearby Pennsylvania state parks. Every entry names its manager; coverage can be expanded with additional official sources.</p></header>
    <form className="library-filters" onSubmit={e => e.preventDefault()}>
      <label>Find an area or resource<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Whipple, Musser Gap, Mount Nittany, PDF…" /></label>
      <label>Activity<select value={activity} onChange={e => setActivity(e.target.value)}><option value="hiking">Hiking</option><option value="cycling">Cycling (not e-bikes)</option></select></label>
      <label>Resource type<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All official resources</option><option value="pdf">PDF / offline map links</option></select></label>
    </form>
    {indexError && <div className="error-message" role="alert">{indexError}<button className="text-button" onClick={() => setRetry(v => v + 1)}>Retry official index</button></div>}
    <div className="library-columns">
      <section className="library-documents" aria-label="Official resource links">
        <h2>Maps & manager resources <span>{visibleAreas.length} area{visibleAreas.length === 1 ? '' : 's'}</span></h2>
        {visibleAreas.map(item => {
          let resources = item.resources.filter(r => !pdfOnly || r.kind === 'pdf')
          const matching = resources.filter(r => tokens.every(word => `${r.title} ${r.url}`.toLowerCase().includes(word)))
          if (matching.length) resources = matching
          if (!resources.length) return null
          return <article className="official-area" key={item.id}>
            <div className="official-badge">Official manager source</div><h3>{item.name}</h3><p>{item.region}</p><p className="source-manager">{item.manager} · link checked {item.checked_on}</p>
            {item.activity_note && <p className="source-notice">{item.activity_note}</p>}
            <OfficialLinks resources={resources} />
            <button className="text-button" onClick={() => { setAreaId(item.id); setTrailQuery(''); routeSection.current?.scrollIntoView({block:'start'}) }}>{item.geometry_available ? 'Browse manager-listed routes →' : 'Check digital route availability →'}</button>
          </article>
        })}
        {!visibleAreas.length && areas.length > 0 && <p className="empty-state">No indexed official source matches this search. This pilot does not cover every region. Try another area or activity.</p>}
      </section>
      <section className="library-routes" ref={routeSection} aria-labelledby="official-routes-title">
        <h2 id="official-routes-title">Load an official route</h2>
        <label className="area-picker">Managed area<select value={areaId} onChange={e => { setAreaId(e.target.value); setTrailQuery('') }}>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <p className="source-notice">Activity permissions are checked on every segment. A hiking trail is not automatically a cycling route. Current closures may not be reflected in the GIS; check manager notices and on-site signs.</p>
        {area && !area.geometry_available && <div className="empty-state">Official documents are indexed for this area, but a connected digital geometry source is not available here yet. Use the publisher's original maps below; no route will be drawn from estimated points.<OfficialLinks resources={area.resources} /></div>}
        {area?.geometry_available && <>
          <label className="area-picker">Filter route names<input type="search" value={trailQuery} onChange={e => setTrailQuery(e.target.value)} placeholder="Search official route names" /></label>
          {loading && <p className="chat-status" role="status">Checking the manager's live trail data…</p>}
          {error && <div className="error-message" role="alert">{error}<button className="text-button" onClick={() => setRetry(v => v + 1)}>Retry official source</button><OfficialLinks resources={area.resources} /></div>}
          {retrieved && <p className="source-manager">Source checked {new Date(retrieved).toLocaleString()} · public DCNR GIS</p>}
          {!loading && !error && !visibleTrails.length && <p className="empty-state">No complete manager-listed route matches this activity and name. Permissions are not relaxed automatically. Original manager resources remain available.</p>}
          {visibleTrails.map(trail => <article className="official-route-result" key={trail.id}><div><h3>{trail.name}</h3><p>{trail.area} · {trail.activity} permitted on all included segments</p><p>{trail.blazes.filter(b => b !== 'N/A').join(' / ')} {trail.blazes.some(b => b !== 'N/A') ? 'blazes · ' : ''}{trail.segment_count} source feature{trail.segment_count === 1 ? '' : 's'}</p></div><button className="primary-button" onClick={() => openTrail(trail)} disabled={opening !== null}>{opening === trail.id ? 'Loading geometry…' : 'View official route'}</button></article>)}
          <p className="source-manager"><a href="https://www.gis.dcnr.state.pa.us/agsprod/rest/services/Parks/StateParksTrailsSimplifiedPortal/MapServer/0" target="_blank" rel="noopener noreferrer">View source metadata and terms ↗</a></p>
        </>}
      </section>
    </div>
  </section>
}
