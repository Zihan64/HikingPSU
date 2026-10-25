import { useEffect, useMemo, useRef, useState } from 'react'
import { DRIVES, LENGTHS, TYPES, filterDrives, formatDuration, mapsUrl } from './drives'
import './drives.css'

// Scenic drives: mountain roads, valley byways and forest loops around State College.
// Same two-column layout as the Trails catalog (list on the left, length filter on the right).

function TypeTag({ drive }) {
  const t = TYPES[drive.type]
  return <span className="catalog-level" style={{ color: t.color }}>{t.label}</span>
}

function DriveDetail({ drive, backLabel, onBack }) {
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  return <article className="catalog-detail">
    <button className="text-button" onClick={onBack}>← Back to {backLabel}</button>
    <header>
      <span className="eyebrow">SCENIC DRIVE · {drive.roads}</span>
      <h1 ref={heading} tabIndex={-1}>{drive.name}</h1>
      <p>{drive.summary}</p>
      <TypeTag drive={drive} />
    </header>
    <dl className="catalog-stats">
      <div><dt>Distance</dt><dd>about {drive.miles} mi</dd></div>
      <div><dt>Driving time</dt><dd>{formatDuration(drive.minutes)}</dd></div>
      <div><dt>From campus</dt><dd>{drive.fromCampus}</dd></div>
      <div><dt>Road</dt><dd>{drive.surface}</dd></div>
    </dl>
    <div className="catalog-detail-columns">
      <div>
        <section className="catalog-section">
          <h2>The drive</h2>
          <p>{drive.description}</p>
          <a className="primary-button drive-maps" href={mapsUrl(drive)} target="_blank" rel="noopener noreferrer">Open route in Google Maps ↗</a>
          <p className="catalog-muted">{drive.loop} · times are estimates without stops. Directions start at Old Main.</p>
        </section>
        <section className="catalog-section">
          <h2>Along the way</h2>
          <ol className="drive-stops">{drive.stops.map((s, i) => <li key={i}><span aria-hidden="true" />{s}</li>)}</ol>
        </section>
      </div>
      <div>
        <section className="catalog-section">
          <h2>Good to know</h2>
          <div className="catalog-chips">{drive.seasons.map(s => <span key={s}>{s}</span>)}</div>
          <ul>{drive.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </section>
        <section className="catalog-section">
          <h2>Sources</h2>
          <ul className="drive-sources">{drive.sources.map(([label, url]) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a></li>)}</ul>
          <p className="catalog-muted">Road conditions change. Check closures and weather before you set out, especially on state forest roads.</p>
        </section>
      </div>
    </div>
  </article>
}

export default function ScenicDrives({ active }) {
  const [length, setLength] = useState('all'), [query, setQuery] = useState(''), [sort, setSort] = useState('time')
  const [selectedId, setSelectedId] = useState(null)
  const list = useRef(null), scroll = useRef(0), lastSelected = useRef(null)
  const visible = useMemo(() => filterDrives(DRIVES, { length, query, sort }), [length, query, sort])
  const counts = useMemo(() => Object.fromEntries(LENGTHS.map(l => [l.id, l.id === 'all' ? DRIVES.length : DRIVES.filter(d => d.length === l.id).length])), [])
  const bucket = LENGTHS.find(l => l.id === length)
  const selected = DRIVES.find(d => d.id === selectedId)
  useEffect(() => {
    if (selectedId || !active) return
    const frame = requestAnimationFrame(() => {
      if (!list.current) return
      list.current.scrollTop = scroll.current
      if (lastSelected.current) list.current.querySelector(`[data-drive-id="${lastSelected.current}"]`)?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId, active])
  function resetScroll() { scroll.current = 0; list.current?.scrollTo({ top: 0 }) }
  if (!active) return null
  return <section className="trail-catalog scenic-drives" aria-label="Scenic drives">
    {selected ? <DriveDetail key={selected.id} drive={selected} backLabel={length === 'all' ? 'all drives' : bucket.name.toLowerCase()} onBack={() => setSelectedId(null)} /> : <>
      <header className="catalog-intro"><span className="eyebrow">BEYOND THE TRAILHEAD</span><h1>Scenic drives</h1><p>Mountain roads, valley byways and forest loops within a day of campus.</p></header>
      <div className="catalog-columns">
        <section className="catalog-results" aria-label="Searchable list of drives">
          <form className="catalog-search" onSubmit={e => e.preventDefault()}>
            <label>Find a drive<input type="search" value={query} onChange={e => { setQuery(e.target.value); resetScroll() }} placeholder="Road, town, lake or overlook…" /></label>
            <label>Sort by<select value={sort} onChange={e => { setSort(e.target.value); resetScroll() }}><option value="time">Trip length</option><option value="distance">Distance</option><option value="name">Name</option></select></label>
            <p role="status">{visible.length} drive{visible.length === 1 ? '' : 's'}{length === 'all' ? ' around State College' : ` · ${bucket.name.toLowerCase()}`}</p>
          </form>
          <div className="catalog-list" ref={list} onScroll={e => { scroll.current = e.currentTarget.scrollTop }}>
            {visible.map(d => <button key={d.id} type="button" data-drive-id={d.id} className="catalog-row" onClick={() => { scroll.current = list.current.scrollTop; lastSelected.current = d.id; setSelectedId(d.id) }}>
              <div className="catalog-row-title"><h2>{d.name}</h2><TypeTag drive={d} /></div>
              <p>{d.roads} · {d.fromCampus}</p>
              <p>about {d.miles} mi · {formatDuration(d.minutes)} driving · {d.surface}</p>
              <span className="drive-summary">{d.summary}<span aria-hidden="true">↗</span></span>
            </button>)}
            {!visible.length && <div className="empty-state">No drives match this search.<button className="text-button" onClick={() => { setQuery(''); setLength('all') }}>Clear search & filters</button></div>}
          </div>
        </section>
        <aside className="catalog-parks" aria-label="Choose a trip length"><h2>How much time?</h2>
          <div className="catalog-park-list">{LENGTHS.map(l => <div key={l.id} className={`catalog-park ${length === l.id ? 'is-selected' : ''}`}>
            <button type="button" onClick={() => { setLength(l.id); resetScroll() }} aria-pressed={length === l.id}><span>{l.name}<small>{l.note}</small></span><b>{counts[l.id]}</b></button>
          </div>)}</div>
          <div className="drive-tips">
            <h3>On the road</h3>
            <ul>
              <li>Drive to the limit; these are shared roads with buggies, cyclists and deer.</li>
              <li>Forest gravel roads aren’t maintained in winter.</li>
              <li>Signal drops in the forests; download maps first.</li>
            </ul>
          </div>
        </aside>
      </div>
    </>}
  </section>
}
