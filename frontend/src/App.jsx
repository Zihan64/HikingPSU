import { useEffect, useMemo, useRef, useState } from 'react'
import { chat, getReviewSummaries, listTrails } from './api'
import TrailCard from './TrailCard'
import MapView from './MapView'
import useDeviceLayout from './useDeviceLayout'
import useLocation from './useLocation'
import LocationControl from './LocationControl'
import OfficialLibrary, { OfficialLinks } from './OfficialLibrary'
import RouteReference from './RouteReference'
import { prepareRouteReference } from './trailGeometry'
import ReviewModal from './ReviewModal'
import AuthButton from './AuthButton'
import { AUTH_ENABLED, useOptionalToken } from './auth'
import { LEVEL_HEX, LEVEL_LABELS } from './levels'

const SUGGESTIONS = [
  ['A view without a car', 'Saturday afternoon, two of us, no car, ~3 hours, want a view'],
  ['My first hike', 'Something easy for a first-time hiker, near campus'],
  ['A little more adventure', 'I have a car, want something hard with rocks on Sunday'],
]
const VIEWS = [['plan', 'Plan'], ['trails', 'Trails'], ['map', 'Map'], ['library', 'Library']]

function Icon({ name, ...props }) {
  const paths = {
    plan: <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />,
    trails: <><path d="m3 17 5-10 5 10M11 17l5-13 5 13M2 21h20" /><path d="m6 11 2 2 2-2" /></>,
    map: <><path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></>,
    send: <path d="m5 12 7-7 7 7M12 5v15" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    library: <><path d="M3 4h6a4 4 0 0 1 3 1 4 4 0 0 1 3-1h6v16h-6a4 4 0 0 0-3 1 4 4 0 0 0-3-1H3Z" /><path d="M12 5v16" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}

function MessageText({ text }) {
  return text.split(/(https:\/\/[^\s<>"\u3002]+)/g).map((part, i) => part.startsWith('https://')
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part)
}

export default function App() {
  const { isCompact, isTouch, reducedMotion } = useDeviceLayout()
  const location = useLocation()
  const [mapFocus, setMapFocus] = useState({ kind: 'trails', version: 0 })
  const [mobileView, setMobileView] = useState('plan')
  const [officialRoute, setOfficialRoute] = useState(null)
  const [reverseReference, setReverseReference] = useState(false)
  const [libraryTrailId, setLibraryTrailId] = useState(null)
  const routeReference = useMemo(() => officialRoute ? prepareRouteReference(officialRoute.geojson, reverseReference) : null, [officialRoute, reverseReference])
  const libraryOpen = mobileView === 'library'
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [allTrails, setAllTrails] = useState([])
  const [recommended, setRecommended] = useState([])
  const [hasResult, setHasResult] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [hasCar, setHasCar] = useState(false)
  const [loading, setLoading] = useState(false)
  const [trailsLoading, setTrailsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [summaries, setSummaries] = useState({})
  const [reviewing, setReviewing] = useState(null)
  const [reviewsVersion, setReviewsVersion] = useState(0)
  const [sessionId, setSessionId] = useState(null)
  const getToken = useOptionalToken()
  const refreshSummaries = () => getReviewSummaries().then(setSummaries).catch(() => {})
  const shellRef = useRef(null)
  const conversationRef = useRef(null)
  const trailListRef = useRef(null)
  const sendingRef = useRef(false)
  const scrollToSelected = useRef(false)
  const focusMapSelection = useRef(false)
  const mapDetailsRef = useRef(null)

  useEffect(() => {
    if (isCompact && mobileView !== 'map') location.stopTracking()
  }, [isCompact, mobileView, location.stopTracking])

  useEffect(() => {
    let cancelled = false
    refreshSummaries()
    listTrails()
      .then(ts => {
        if (!cancelled) setAllTrails([...ts].sort((a, b) => a.difficulty.level - b.difficulty.level || a.distance_mi - b.distance_mi))
      })
      .catch(() => { if (!cancelled) setLoadError("We couldn't load the trails. Please refresh to try again.") })
      .finally(() => { if (!cancelled) setTrailsLoading(false) })
    return () => { cancelled = true }
  }, [])

  // A phone's keyboard can shrink the visual viewport while 100dvh still
  // describes the area behind it. Keep the composer inside the visible area.
  useEffect(() => {
    if (!isCompact || !window.visualViewport) return
    const viewport = window.visualViewport
    const resize = () => {
      const shell = shellRef.current
      if (!shell) return
      shell.style.setProperty('--app-height', `${viewport.height}px`)
      if (viewport.height <= 580) shell.dataset.shortViewport = viewport.height <= 420 ? 'tiny' : 'short'
      else delete shell.dataset.shortViewport
    }
    resize()
    viewport.addEventListener('resize', resize)
    return () => {
      viewport.removeEventListener('resize', resize)
      shellRef.current?.style.removeProperty('--app-height')
      if (shellRef.current) delete shellRef.current.dataset.shortViewport
    }
  }, [isCompact])

  useEffect(() => {
    const pane = conversationRef.current
    if (pane && (messages.length || loading) && (!isCompact || mobileView === 'plan')) {
      pane.scrollTo({ top: pane.scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' })
    }
  }, [messages, loading, mobileView, isCompact, reducedMotion])

  useEffect(() => {
    if (!scrollToSelected.current || (isCompact && mobileView !== 'trails')) return
    const card = document.getElementById(`trail-${selectedId}`)
    if (card) {
      card.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'nearest' })
      card.focus({ preventScroll: true })
    }
    scrollToSelected.current = false
  }, [selectedId, mobileView, isCompact, hasResult])

  useEffect(() => {
    if (focusMapSelection.current && isCompact && mobileView === 'map') {
      mapDetailsRef.current?.focus({ preventScroll: true })
      focusMapSelection.current = false
    }
  }, [selectedId, mobileView, isCompact])

  async function send(text) {
    if (sendingRef.current || !text.trim()) return
    sendingRef.current = true
    const next = [...messages, { role: 'user', content: text.trim() }]
    setMessages(next); setInput(''); setLoading(true); setError(null)
    try {
      const res = await chat(next, { has_car: hasCar }, { token: await getToken(), sessionId })
      if (res.session_id) setSessionId(res.session_id)
      setMessages([...next, { role: 'assistant', content: res.reply }])
      // Off-topic requests are declined without any tool call: keep the current trail list as it is.
      if (!res.trails.length && !res.tool_log?.length) return
      const resourcesOnly = !res.trails.length && res.tool_log?.some(entry => entry.tool === 'search_official_resources')
      setRecommended(res.trails); setSelectedId(null); setHasResult(!resourcesOnly)
      if (!resourcesOnly) {
        location.stopTracking(); setOfficialRoute(null)
        setMapFocus(previous => ({ kind: 'trails', version: previous.version + 1 }))
      }
      trailListRef.current?.scrollTo({ top: 0 })
    } catch (err) {
      // 429 = rate limit, 413/422 = message too long: show the server's reason. Anything else stays generic.
      setError([413, 422, 429].includes(err?.status) ? err.message : "We couldn't get a recommendation. Please try again.")
    } finally {
      sendingRef.current = false
      setLoading(false)
    }
  }

  const recIds = hasResult ? recommended.map(t => t.id) : []
  const mapTrails = allTrails.length ? allTrails : recommended
  const cards = hasResult ? recommended : allTrails
  const selectedTrail = mapTrails.find(t => t.id === selectedId)
  const mapVisible = !libraryOpen && (!isCompact || mobileView === 'map')

  function changeView(view) {
    if (view === 'library' || (isCompact && view !== 'map')) location.stopTracking()
    setMobileView(view)
  }

  function openOfficialLibrary(trailId = null) {
    setLibraryTrailId(trailId)
    changeView('library')
  }

  function openOfficialRoute(data) {
    location.stopTracking()
    setOfficialRoute(data); setReverseReference(false); setSelectedId(null); setHasResult(false)
    setMapFocus(previous => ({kind: 'route', version: previous.version + 1}))
    setMobileView('map')
  }

  function closeOfficialRoute() {
    location.stopTracking(); setOfficialRoute(null)
    setMapFocus(previous => ({kind: 'trails', version: previous.version + 1}))
  }

  function followPosition() {
    setSelectedId(null)
    setMapFocus(previous => ({kind: 'location', version: previous.version + 1}))
    location.startTracking()
  }

  function selectFromCard(id) {
    location.stopTracking(); setOfficialRoute(null)
    setSelectedId(id)
    setMapFocus(previous => ({ kind: 'trail', version: previous.version + 1 }))
    if (isCompact) { focusMapSelection.current = true; setMobileView('map') }
  }

  function selectFromMap(id) {
    setSelectedId(id)
    setMapFocus(previous => ({ kind: 'trail', version: previous.version + 1 }))
  }

  function requestLocation() {
    setSelectedId(null)
    setMapFocus(previous => ({ kind: 'location', version: previous.version + 1 }))
    location.request()
  }

  function showTrailsOnMap() {
    setSelectedId(null)
    setMapFocus(previous => ({ kind: officialRoute ? 'route' : 'trails', version: previous.version + 1 }))
  }

  function clearLocation() {
    location.clear()
    showTrailsOnMap()
  }

  function showSelectedDetails() {
    if (!cards.some(t => t.id === selectedId)) setHasResult(false)
    scrollToSelected.current = true
    setMobileView('trails')
  }

  function showAll() {
    setHasResult(false); setSelectedId(null)
    setMapFocus(previous => ({ kind: 'trails', version: previous.version + 1 }))
  }

  return (
    <div className="app-shell" ref={shellRef} data-layout={isCompact ? 'compact' : 'desktop'} data-input={isTouch ? 'touch' : 'pointer'}>
      <header className="app-header">
        <a className="brand" href="#" aria-label="HikingPSU home" onClick={e => { e.preventDefault(); changeView('plan') }}>
          <span className="brand-symbol"><Icon name="trails" /></span>
          <span><span className="brand-name">HikingPSU</span><span className="brand-caption">A little closer to the outdoors.</span></span>
        </a>
        <div className="header-actions">
          <nav className="desktop-navigation" aria-label="Workspace"><button onClick={() => changeView('plan')} aria-pressed={!libraryOpen}>Explore</button><button onClick={() => openOfficialLibrary()} aria-pressed={libraryOpen}>Official library</button></nav>
          <span className="location-label"><span />Happy Valley, PA</span>
          {AUTH_ENABLED && <div className="auth-control"><AuthButton /></div>}
        </div>
      </header>

      <main className={`workspace ${libraryOpen ? 'workspace-library' : officialRoute && !isCompact ? 'workspace-route' : ''}`}>
        <div id="library-panel" className="library-workspace" hidden={!libraryOpen}><OfficialLibrary active={libraryOpen} trailId={libraryTrailId} onOpenRoute={openOfficialRoute} /></div>
        {officialRoute && !isCompact && <aside className="route-sidebar" hidden={libraryOpen} aria-label="Route reference and official resources"><RouteReference data={officialRoute} reference={routeReference} location={location} onLive={followPosition} onReverse={() => setReverseReference(v => !v)} onClose={closeOfficialRoute} /><OfficialLinks resources={officialRoute.route.resources} /><button className="text-button" onClick={() => openOfficialLibrary()}>Browse other official routes</button><button className="text-button" onClick={closeOfficialRoute}>Return to the hiking planner</button></aside>}
        <section id="plan-panel" className="planner" aria-labelledby="plan-title" hidden={libraryOpen || (!isCompact && officialRoute) || (isCompact && mobileView !== 'plan')}>
          <div className="panel-heading">
            <span className="eyebrow">YOUR NEXT OUTING</span>
            <h1 id="plan-title">Find your kind of trail.</h1>
            <p>A quick campus walk or a rocky ridge? Let's plan it.</p>
            <button className="text-button official-library-shortcut" onClick={() => openOfficialLibrary()}>Browse official routes & offline map links →</button>
          </div>
          <label className="transport-option">
            <input type="checkbox" checked={hasCar} onChange={e => setHasCar(e.target.checked)} />
            <span>I have a car<span className="transport-hint">{hasCar ? 'Explore a little further' : 'Start with bus & walk options'}</span></span>
          </label>

          <div className="conversation" ref={conversationRef} role="log" aria-label="Hiking planner conversation" aria-live="polite" aria-relevant="additions text" aria-busy={loading}>
            {messages.length === 0 && (
              <div className="welcome">
                <span className="welcome-icon"><Icon name="plan" /></span>
                <h2>Where do you want to go?</h2>
                <p>Tell me your time, transport and who's coming along. Or start here:</p>
                <div className="suggestions">
                  {SUGGESTIONS.map(([label, text]) => (
                    <button key={label} type="button" disabled={loading} onClick={() => send(text)}>
                      <span>{label}</span><Icon name="arrow" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`message message-${m.role}`}>
                <span className="message-author">{m.role === 'user' ? 'You' : 'HikingPSU'}</span>
                <p>{m.role === 'assistant' ? <MessageText text={m.content} /> : m.content}</p>
              </div>
            ))}
            {loading && <p className="chat-status" role="status">Finding matching trails<span className="loading-dots">…</span></p>}
            {error && <p className="error-message" role="alert">{error}</p>}
          </div>

          {isCompact && hasResult && !loading && (
            <button className="results-shortcut" onClick={() => setMobileView('trails')}>
              <span>{recommended.length ? `${recommended.length} matching trails · view results` : 'View search results'}</span><Icon name="arrow" />
            </button>
          )}
          <form className="composer" onSubmit={e => { e.preventDefault(); send(input) }}>
            <label className="sr-only" htmlFor="hike-input">Describe your hike</label>
            <input id="hike-input" maxLength={500} value={input} onChange={e => setInput(e.target.value)} placeholder="Describe your hike…" enterKeyHint="send" autoComplete="off" />
            <button className="primary-button send-button" disabled={loading || !input.trim()} aria-label="Send message"><Icon name="send" /><span className="send-label">Send</span></button>
          </form>
          <p className="composer-note">Local trails. Clear difficulty. A plan that fits you.</p>
        </section>

        <section className="explorer" aria-label="Explore local trails" hidden={libraryOpen || (isCompact && mobileView === 'plan')}>
          <section id="map-panel" className="map-panel" hidden={isCompact && mobileView !== 'map'} aria-label="Trail map">
            <div className="map-heading"><span className="eyebrow">{officialRoute ? 'MANAGER-PUBLISHED ROUTE' : 'EXPLORE HAPPY VALLEY'}</span><span>{officialRoute ? officialRoute.route.area : `${mapTrails.length} local trails`}</span></div>
            <LocationControl location={location} onRequest={requestLocation} onClear={clearLocation} onShowTrails={showTrailsOnMap} routeActive={!!officialRoute} />
            {officialRoute && isCompact && <RouteReference data={officialRoute} reference={routeReference} location={location} onLive={followPosition} onReverse={() => setReverseReference(v => !v)} onClose={closeOfficialRoute} />}
            <div className="map-canvas">
              <MapView trails={officialRoute ? [] : mapTrails} recIds={officialRoute ? [] : recIds} selectedId={selectedId} onSelect={selectFromMap} active={mapVisible} touch={isTouch} compact={isCompact} reducedMotion={reducedMotion} userPosition={location.position} mapFocus={mapFocus} officialRoute={officialRoute} />
              {isCompact && selectedTrail && (
                <div className="map-selection">
                  <div><span className="eyebrow">SELECTED TRAIL · L{selectedTrail.difficulty.level}</span><h2>{selectedTrail.name}</h2><p>{selectedTrail.distance_mi} mi · {selectedTrail.difficulty.est_time_min} min hiking</p></div>
                  <button className="primary-button" ref={mapDetailsRef} onClick={showSelectedDetails}>Trail details <Icon name="arrow" /></button>
                </div>
              )}
            </div>
            <div className="map-legend" aria-label={officialRoute ? 'Official route legend' : 'Trail difficulty legend'}>
              {officialRoute ? <><span><i style={{background: '#0f766e'}} />Manager-published route</span><span><i style={{background: '#2563eb'}} />Your location (when enabled)</span></> : [1, 2, 3, 4, 5].map(l => <span key={l}><i style={{ background: LEVEL_HEX[l] }} />L{l} {LEVEL_LABELS[l]}</span>)}
            </div>
            <p className="map-hint">{officialRoute ? 'Original geometry · check current manager notices and trail signs' : isTouch ? 'Drag to explore · pinch to zoom · tap a trail' : 'Select a pin or trail card to explore'}</p>
          </section>

          <section id="trails-panel" className="trail-list" ref={trailListRef} hidden={isCompact && mobileView !== 'trails'} aria-labelledby="trails-title">
            {officialRoute ? <article className="official-area selected-official-summary"><span className="official-badge">Official manager geometry</span><h2 id="trails-title">{officialRoute.route.name}</h2><p>{officialRoute.route.area} · {officialRoute.route.manager}</p><p>{officialRoute.route.description}</p><p className="source-notice">{officialRoute.source_notice}</p><OfficialLinks resources={officialRoute.route.resources} /><div className="route-reference-actions"><button className="primary-button" onClick={() => { showTrailsOnMap(); setMobileView('map') }}>View official route on map</button><button className="text-button" onClick={() => openOfficialLibrary()}>Browse other official routes</button></div></article> : <>
            <div className="trail-list-heading">
              <div><span className="eyebrow">{hasResult ? 'PICKED FOR YOUR PLANS' : 'SOMEWHERE GOOD TO GO'}</span><h2 id="trails-title">{hasResult ? 'Your trail matches' : 'Around Happy Valley'} <span>{cards.length}</span></h2></div>
              {hasResult && <button className="text-button" onClick={showAll}>Show all trails</button>}
            </div>
            {isCompact && <p className="list-hint">Tap a trail to find it on the map.</p>}
            {loadError && <p className="error-message" role="alert">{loadError}</p>}
            {cards.map(t => <TrailCard key={t.id} t={t} selected={t.id === selectedId} onSelect={() => selectFromCard(t.id)} onOfficialResources={() => openOfficialLibrary(t.id)} summary={summaries[t.id]} onReview={() => setReviewing(t)} reviewsVersion={reviewsVersion} />)}
            {cards.length === 0 && <div className="empty-state" role="status">{trailsLoading && !hasResult ? 'Loading trails…' : hasResult ? 'No trails matched this request. Try changing your preferences or browse all trails.' : 'No trails are available right now.'}</div>}
            </>}
          </section>
        </section>
      </main>
      {reviewing && <ReviewModal trail={reviewing} onClose={() => setReviewing(null)} onSaved={() => { refreshSummaries(); setReviewsVersion(v => v + 1) }} />}

      {isCompact && (
        <nav className="mobile-navigation" aria-label="Workspace views">
          {VIEWS.map(([view, label]) => (
            <button key={view} type="button" aria-pressed={mobileView === view} aria-controls={`${view}-panel`} onClick={() => changeView(view)}>
              <span className="nav-icon"><Icon name={view} />{view === 'trails' && hasResult && recommended.length > 0 && <span className="nav-badge">{recommended.length}</span>}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
