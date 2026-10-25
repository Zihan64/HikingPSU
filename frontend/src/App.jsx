import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chat, getActiveCheckin, getCommentHighlights, getRecommendations, getReviewSummaries, listTrails } from './api'
import TrailCard from './TrailCard'
import MapView from './MapView'
import useDeviceLayout from './useDeviceLayout'
import useLocation from './useLocation'
import LocationControl, { LocationStatus } from './LocationControl'
import OfficialLibrary, { OfficialLinks } from './OfficialLibrary'
import RouteReference from './RouteReference'
import { prepareRouteReference } from './trailGeometry'
import ReviewModal from './ReviewModal'
import Dashboard from './Dashboard'
import Onboarding from './Onboarding'
import Community from './Community'
import AppHeader, { HomeLink } from './AppHeader'
import Icon from './Icon'
import useMapFullscreen from './useMapFullscreen'
import { useAuth0 } from '@auth0/auth0-react'
import { AUTH_ENABLED, useOptionalToken } from './auth'
import { finishesCheckin } from './checkin'
import AppBackdrop from './theme/AppBackdrop'
import { LEVEL_HEX, LEVEL_LABELS } from './levels'
import { parseBlocks, parseInline } from './markdown'
import { distanceToTrail, sortTrails } from './trailSort'
import TrailCatalog from './TrailCatalog'
import ScenicDrives from './drives/ScenicDrives'
import ActiveCheckinBanner from './ActiveCheckinBanner'

const SUGGESTIONS = [
  ['A view without a car', 'Saturday afternoon, two of us, no car, ~3 hours, want a view'],
  ['My first hike', 'Something easy for a first-time hiker, near campus'],
  ['A little more adventure', 'I have a car, want something hard with rocks on Sunday'],
]
const VIEWS = [['plan', 'Plan'], ['trails', 'Results'], ['map', 'Map'], ['catalog', 'Trails'], ['drives', 'Drives'], ['community', 'Community'], ['library', 'Library']]

function Inline({ tokens }) {
  return tokens.map((tok, i) => tok.t === 'link' ? <a key={i} href={tok.v} target="_blank" rel="noopener noreferrer">{tok.v}</a>
    : tok.t === 'bold' ? <strong key={i}><Inline tokens={tok.children} /></strong>
      : tok.t === 'em' ? <em key={i}><Inline tokens={tok.children} /></em>
        : tok.t === 'code' ? <code key={i}>{tok.v}</code> : tok.v)
}

// Assistant replies may use light Markdown; render it instead of showing raw ** and - markers.
function MessageText({ text }) {
  return <div className="message-body">{parseBlocks(text).map((b, i) => {
    if (b.type === 'h') return <p key={i} className="message-heading"><Inline tokens={parseInline(b.text)} /></p>
    if (b.type === 'p') return <p key={i}><Inline tokens={parseInline(b.text)} /></p>
    const List = b.ordered ? 'ol' : 'ul'
    return <List key={i}>{b.items.map((it, j) => <li key={j} className={it.level ? 'nested' : undefined}><Inline tokens={parseInline(it.text)} /></li>)}</List>
  })}</div>
}

export default function App() {
  const { isCompact, isTouch, reducedMotion } = useDeviceLayout()
  const location = useLocation()
  const [mapFocus, setMapFocus] = useState({ kind: 'trails', version: 0 })
  const [mobileView, setMobileView] = useState('plan')
  const [mapExpanded, setMapExpanded] = useState(false)
  const [homeVisit, setHomeVisit] = useState(0)
  const [officialRoute, setOfficialRoute] = useState(null)
  const [reverseReference, setReverseReference] = useState(false)
  const [libraryTrailId, setLibraryTrailId] = useState(null)
  const [libraryAreaId, setLibraryAreaId] = useState(null)
  const routeReference = useMemo(() => officialRoute ? prepareRouteReference(officialRoute.geojson, reverseReference) : null, [officialRoute, reverseReference])
  const libraryOpen = mobileView === 'library'
  const profileOpen = mobileView === 'profile'
  const catalogOpen = mobileView === 'catalog'
  const drivesOpen = mobileView === 'drives'
  const communityOpen = mobileView === 'community'
  const fullPage = libraryOpen || profileOpen || catalogOpen || drivesOpen || communityOpen   // views that replace the planner/map workspace
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [allTrails, setAllTrails] = useState([])
  const [recommended, setRecommended] = useState([])
  const [hasResult, setHasResult] = useState(false)
  const [sortMode, setSortMode] = useState('recommended')
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [trailsLoading, setTrailsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [summaries, setSummaries] = useState({})
  const [reviewing, setReviewing] = useState(null)
  const [finishing, setFinishing] = useState(null)   // check-in being finished in the review modal, if any
  const [activeCheckin, setActiveCheckin] = useState(null)   // signed-in only: the current trailhead check-in
  const [catalogTrail, setCatalogTrail] = useState(null)   // {id}: open this trail in the Trails page
  const [reviewsVersion, setReviewsVersion] = useState(0)
  const [highlights, setHighlights] = useState({})   // trail id -> top community comments
  const [sessionId, setSessionId] = useState(null)
  const getToken = useOptionalToken()
  const { isAuthenticated } = useAuth0()
  const signedIn = AUTH_ENABLED && isAuthenticated
  const [ranking, setRanking] = useState(null)   // signed-in only: trails that fit you, best first
  const [profileVersion, setProfileVersion] = useState(0) // bumped when the sign-up form is saved or a check-in is finished
  const refreshSummaries = () => getReviewSummaries().then(setSummaries).catch(() => {})
  const checkinRequest = useRef(0)
  // Latest active check-in, as the server reports it (the server expires check-ins, not the device clock).
  const refreshCheckin = useCallback(async () => {
    const version = ++checkinRequest.current
    try {
      const token = await getToken()
      // No token while still signed in means the silent refresh failed, not that there's no check-in.
      if (!token && signedIn) return
      const current = token ? await getActiveCheckin(token) : null
      if (version !== checkinRequest.current) return
      setActiveCheckin(current)
    } catch { /* keep the last known check-in; the next refresh retries */ }
  }, [getToken, signedIn])
  const changeCheckin = useCallback(next => { checkinRequest.current++; setActiveCheckin(next) }, [])
  const shellRef = useRef(null)
  const conversationRef = useRef(null)
  const trailListRef = useRef(null)
  const sendingRef = useRef(false)
  const scrollToSelected = useRef(false)
  const focusMapSelection = useRef(false)
  const mapDetailsRef = useRef(null)
  const mapPanelRef = useRef(null)
  const mapExpandRef = useRef(null)
  const homeVersion = useRef(0)
  const closeMapPreview = useCallback(() => setMapExpanded(false), [])
  useMapFullscreen(mapExpanded, closeMapPreview, mapPanelRef, mapExpandRef, shellRef)

  useEffect(() => {
    if (homeVisit) document.getElementById('plan-title')?.focus({preventScroll:true})
  }, [homeVisit])

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

  // Personal order for the trail list. Refetched on login/logout, after leaving the profile,
  // where preferences and the hike log change, and after the sign-up form is saved.
  useEffect(() => {
    if (profileOpen) return
    let cancelled = false
    getToken()
      .then(token => token ? getRecommendations(token, 200) : null)
      .then(r => { if (!cancelled) setRanking(r?.trails ?? null) })
      .catch(() => { if (!cancelled) setRanking(null) })
    return () => { cancelled = true }
  }, [getToken, profileOpen, profileVersion])

  // Active check-in: loaded on login/logout and whenever the tab becomes visible again
  // (it may have been finished elsewhere); dropped when it expires.
  useEffect(() => {
    refreshCheckin()
    const onVisible = () => { if (!document.hidden) refreshCheckin() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshCheckin])

  // Recheck just after it expires, then every minute while it's still shown (a failed refresh, or a
  // device clock ahead of the server's).
  useEffect(() => {
    const expiresAt = Date.parse(activeCheckin?.expires_at)
    if (!Number.isFinite(expiresAt)) return
    let id
    const schedule = ms => { id = setTimeout(() => { refreshCheckin(); schedule(60000) }, ms) }
    const left = expiresAt - Date.now()
    schedule(left > 0 ? Math.min(2 ** 31 - 1, left + 1000) : 60000)
    return () => clearTimeout(id)
  }, [activeCheckin, refreshCheckin])

  // Top comments for the trail cards. Refetched on login/logout (to show your hearts), after a
  // review is saved, and after leaving the Community page, where hearts may have changed.
  useEffect(() => {
    if (communityOpen) return
    let cancelled = false
    getToken()
      .then(token => getCommentHighlights(token))
      .then(h => { if (!cancelled) setHighlights(h) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [getToken, reviewsVersion, communityOpen])

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
    const version = homeVersion.current
    const next = [...messages, { role: 'user', content: text.trim() }]
    setMessages(next); setInput(''); setLoading(true); setError(null)
    try {
      const res = await chat(next, {}, { token: await getToken(), sessionId })
      if (res.session_id) setSessionId(res.session_id)
      // sig proves the reply came from the server; unsigned assistant turns are dropped from the AI's context.
      setMessages([...next, { role: 'assistant', content: res.reply, sig: res.reply_sig }])
      // Off-topic requests are declined without any tool call: keep the current trail list as it is.
      if (!res.trails.length && !res.tool_log?.length) return
      // Returning home must not reopen a previous search when its reply arrives.
      if (version !== homeVersion.current) return
      const resourcesOnly = !res.trails.length && res.tool_log?.some(entry => entry.tool === 'search_official_resources')
      setRecommended(res.trails); setSelectedId(null); setHasResult(!resourcesOnly)
      if (!resourcesOnly) {
        location.stopTracking(); setOfficialRoute(null)
        setMapFocus(previous => ({ kind: 'trails', version: previous.version + 1 }))
      }
      trailListRef.current?.scrollTo({ top: 0 })
    } catch (err) {
      // 429 = rate limit, 413/422 = message too long: show the server's reason. Anything else stays generic.
      if (version === homeVersion.current) setError([413, 422, 429].includes(err?.status) ? err.message : "We couldn't get a recommendation. Please try again.")
    } finally {
      sendingRef.current = false
      setLoading(false)
    }
  }

  const recIds = hasResult ? recommended.map(t => t.id) : []
  const mapTrails = allTrails.length ? allTrails : recommended
  const fitById = useMemo(() => Object.fromEntries((ranking || []).map(r => [r.trail_id, r])), [ranking])
  // Trails that fit you come first in rank order; the rest keep the default level/distance order.
  const sortedTrails = useMemo(() => {
    if (!ranking) return allTrails
    const byId = Object.fromEntries(allTrails.map(t => [t.id, t]))
    return [...ranking.map(r => byId[r.trail_id]).filter(Boolean), ...allTrails.filter(t => !fitById[t.id])]
  }, [allTrails, ranking, fitById])
  const cards = useMemo(() => sortTrails(hasResult ? recommended : sortedTrails, sortMode, location.position),
    [hasResult, recommended, sortedTrails, sortMode, location.position])
  const selectedTrail = mapTrails.find(t => t.id === selectedId)
  const mapVisible = mapExpanded || (!fullPage && (!isCompact || mobileView === 'map'))

  function goHome() {
    homeVersion.current++
    if (location.status === 'locating' || location.status === 'fallback') location.cancel()
    else location.stopTracking()
    setMapExpanded(false); setOfficialRoute(null); setReverseReference(false)
    setLibraryTrailId(null); setLibraryAreaId(null); setSelectedId(null); setRecommended([]); setHasResult(false)
    setReviewing(null); setFinishing(null); setCatalogTrail(null); setError(null); setMobileView('plan')
    setSortMode('recommended')
    scrollToSelected.current = false; focusMapSelection.current = false
    setMapFocus(previous => ({kind:'trails', version:previous.version + 1}))
    trailListRef.current?.scrollTo({top:0})
    setHomeVisit(v => v + 1)
  }

  function changeView(view) {
    setMapExpanded(false)
    if (view === 'library' || view === 'profile' || view === 'catalog' || view === 'drives' || view === 'community' || (isCompact && view !== 'map')) location.stopTracking()
    setMobileView(view)
  }

  // "I finished this trail" with a finishable check-in on that trail finishes it (badge + hike log).
  function openReview(trail) {
    if (finishesCheckin(activeCheckin, trail.id)) { openFinish(activeCheckin); return }
    setFinishing(null); setReviewing(trail)
  }

  // Finish flow for a check-in: the review modal in finish mode for that trail.
  function openFinish(checkin) {
    setFinishing(checkin)
    setReviewing(allTrails.find(t => t.id === checkin.trail_id) || { id: checkin.trail_id, name: checkin.trail_name })
  }

  function closeReview() {
    setReviewing(null); setFinishing(null)
  }

  function openTrailPage(id) {
    setCatalogTrail({ id })
    changeView('catalog')
  }

  function openOfficialLibrary(trailId = null, areaId = null) {
    setLibraryTrailId(trailId); setLibraryAreaId(areaId)
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
    setMapExpanded(false)
    if (!cards.some(t => t.id === selectedId)) setHasResult(false)
    scrollToSelected.current = true
    setMobileView('trails')
  }

  function showAll() {
    setHasResult(false); setSelectedId(null)
    setMapFocus(previous => ({ kind: 'trails', version: previous.version + 1 }))
  }

  function changeSort(mode) {
    setSortMode(mode)
    trailListRef.current?.scrollTo({top:0})
    // Asking for nearby trails is explicit consent to request browser location.
    // Keep the list visible and preserve the map camera while requesting a fix.
    if (mode === 'nearest' && !location.position) location.request()
  }

  return (
    <div className="app-shell" ref={shellRef} data-layout={isCompact ? 'compact' : 'desktop'} data-input={isTouch ? 'touch' : 'pointer'}>
      <AppBackdrop />
      <AppHeader onHome={goHome} onLibrary={() => openOfficialLibrary()} libraryOpen={libraryOpen} onCatalog={() => changeView('catalog')} catalogOpen={catalogOpen} onDrives={() => changeView('drives')} drivesOpen={drivesOpen} onCommunity={() => changeView('community')} communityOpen={communityOpen} onProfile={() => changeView('profile')} profileOpen={profileOpen} />
      {activeCheckin && <ActiveCheckinBanner checkin={activeCheckin} onFinish={() => openFinish(activeCheckin)} onView={allTrails.some(t => t.id === activeCheckin.trail_id) ? () => openTrailPage(activeCheckin.trail_id) : null} />}

      <main className={`workspace ${fullPage ? 'workspace-library' : officialRoute && !isCompact ? 'workspace-route' : ''}`}>
        <div id="library-panel" className="library-workspace" hidden={!libraryOpen}><OfficialLibrary active={libraryOpen} trailId={libraryTrailId} initialAreaId={libraryAreaId} onOpenRoute={openOfficialRoute} /></div>
        <div id="catalog-panel" className="library-workspace catalog-workspace" hidden={!catalogOpen}><TrailCatalog key={homeVisit} active={catalogOpen} trails={allTrails} summaries={summaries} onReview={openReview} reviewsVersion={reviewsVersion} onOfficialResources={id => openOfficialLibrary(id)} onOfficialArea={id => openOfficialLibrary(null, id)} loading={trailsLoading} loadError={loadError}
          checkin={activeCheckin} onCheckinChange={changeCheckin} onCheckinRefresh={refreshCheckin} onFinishCheckin={openFinish} openTrail={catalogTrail} /></div>
        <div id="drives-panel" className="library-workspace catalog-workspace" hidden={!drivesOpen}><ScenicDrives active={drivesOpen} /></div>
        {profileOpen && <div id="profile-panel" className="library-workspace"><Dashboard trails={allTrails} reloadKey={profileVersion} /></div>}
        {communityOpen && <div id="community-panel" className="library-workspace"><Community trails={allTrails} onReview={openReview} reloadKey={reviewsVersion} /></div>}
        {officialRoute && !isCompact && <aside className="route-sidebar" hidden={fullPage}aria-label="Route reference and official resources"><RouteReference data={officialRoute} reference={routeReference} location={location} onLive={followPosition} onReverse={() => setReverseReference(v => !v)} onClose={closeOfficialRoute} /><OfficialLinks resources={officialRoute.route.resources} /><button className="text-button" onClick={() => openOfficialLibrary()}>Browse other official routes</button><button className="text-button" onClick={closeOfficialRoute}>Return to the hiking planner</button></aside>}
        <section id="plan-panel" className="planner" aria-labelledby="plan-title" hidden={fullPage || (!isCompact && officialRoute) || (isCompact && mobileView !== 'plan')}>
          <div className="panel-heading">
            <span className="eyebrow">YOUR NEXT OUTING</span>
            <h1 id="plan-title" tabIndex={-1}>Find your kind of trail.</h1>
            <p>A quick campus walk or a rocky ridge? Let's plan it.</p>
            <button className="text-button official-library-shortcut" onClick={() => openOfficialLibrary()}>Browse official routes & offline map links →</button>
          </div>

          <div className="conversation" ref={conversationRef} role="log" aria-label="Hiking planner conversation" aria-live="polite" aria-relevant="additions text" aria-busy={loading}>
            {messages.length === 0 && (
              <div className="welcome">
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
                {m.role === 'assistant' ? <MessageText text={m.content} /> : <p>{m.content}</p>}
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

        <section className="explorer" aria-label="Explore local trails" hidden={fullPage || (isCompact && mobileView === 'plan')}>
          <section id="map-panel" ref={mapPanelRef} className={`map-panel ${mapExpanded ? 'map-expanded' : ''}`} hidden={!mapExpanded && isCompact && mobileView !== 'map'} role={mapExpanded ? 'dialog' : undefined} aria-modal={mapExpanded ? 'true' : undefined} aria-label={mapExpanded ? 'Full-screen trail map' : 'Trail map'} tabIndex={-1}>
            <div className="map-info">
            {mapExpanded && <HomeLink compact onHome={goHome} />}
            <div className="map-heading"><div className="map-heading-title">{officialRoute && <span className="eyebrow">MANAGER-PUBLISHED ROUTE</span>}<span>{officialRoute ? officialRoute.route.area : `${mapTrails.length} local trails`}</span></div></div>
            <LocationControl location={location} onRequest={requestLocation} onClear={clearLocation} onShowTrails={showTrailsOnMap} routeActive={!!officialRoute} showStatus={false} />
            <LocationStatus location={location} routeActive={!!officialRoute} showIdle={false} className="map-location-status" />
            {officialRoute && isCompact && <RouteReference data={officialRoute} reference={routeReference} location={location} onLive={followPosition} onReverse={() => setReverseReference(v => !v)} onClose={closeOfficialRoute} />}
            <div className="map-legend" aria-label={officialRoute ? 'Official route legend' : 'Trail difficulty legend'}>
              {officialRoute ? <><span><i style={{background: '#0f766e'}} />Manager-published route</span><span><i style={{background: '#2563eb'}} />Your location (when enabled)</span></> : [1, 2, 3, 4, 5].map(l => <span key={l}><i style={{ background: LEVEL_HEX[l] }} />L{l} {LEVEL_LABELS[l]}</span>)}
            </div>
            <p className="map-hint">{officialRoute ? 'Original geometry · check current manager notices and trail signs' : isTouch ? 'Drag to explore · pinch to zoom · tap a trail' : 'Select a pin or trail card to explore'}</p>
            </div>
            <div className="map-canvas">
              <MapView trails={officialRoute ? [] : mapTrails} recIds={officialRoute ? [] : recIds} selectedId={selectedId} onSelect={selectFromMap} active={mapVisible} touch={isTouch} compact={isCompact} reducedMotion={reducedMotion} userPosition={location.position} mapFocus={mapFocus} officialRoute={officialRoute} />
              <button ref={mapExpandRef} className={`map-expand-button ${mapExpanded ? 'is-exit' : ''}`} onClick={() => setMapExpanded(v => !v)} aria-label={mapExpanded ? 'Exit full-screen map' : 'Expand map'} aria-haspopup={mapExpanded ? undefined : 'dialog'} aria-expanded={mapExpanded} title={mapExpanded ? 'Back to page (Esc)' : 'Expand map'}><Icon name={mapExpanded ? 'back' : 'expand'} />{mapExpanded && <span>Back</span>}</button>
              {isCompact && selectedTrail && (
                <div className="map-selection">
                  <div><span className="eyebrow">SELECTED TRAIL · L{selectedTrail.difficulty.level}</span><h2>{selectedTrail.name}</h2><p>{selectedTrail.distance_mi} mi · {selectedTrail.difficulty.est_time_min} min hiking</p></div>
                  <button className="primary-button" ref={mapDetailsRef} onClick={showSelectedDetails}>Trail details <Icon name="arrow" /></button>
                </div>
              )}
            </div>
          </section>

          {(isCompact || !officialRoute) && <section id="trails-panel" className="trail-list" ref={trailListRef} hidden={isCompact && mobileView !== 'trails'} aria-labelledby="trails-title">
            {officialRoute ? <article className="official-area selected-official-summary"><span className="official-badge">Official manager geometry</span><h2 id="trails-title">{officialRoute.route.name}</h2><p>{officialRoute.route.area} · {officialRoute.route.manager}</p><p>{officialRoute.route.description}</p><p className="source-notice">{officialRoute.source_notice}</p><OfficialLinks resources={officialRoute.route.resources} /><div className="route-reference-actions"><button className="primary-button" onClick={() => { showTrailsOnMap(); setMobileView('map') }}>View official route on map</button><button className="text-button" onClick={() => openOfficialLibrary()}>Browse other official routes</button></div></article> : <>
            <div className="trail-list-heading">
              <h2 id="trails-title">{hasResult ? 'Your trail matches' : 'Around Happy Valley'} <span>{cards.length}</span></h2>
              <div className="trail-sort" role="group" aria-label="Sort trails">
                <button type="button" aria-pressed={sortMode === 'nearest'} onClick={() => changeSort('nearest')}>Nearest</button>
                <button type="button" aria-pressed={sortMode === 'recommended'} onClick={() => changeSort('recommended')}>Recommended</button>
              </div>
              <span className="eyebrow trail-sort-label">{sortMode === 'nearest' ? location.position ? 'NEAREST TO YOU' : 'LOCATION NEEDED' : hasResult ? 'PICKED FOR YOUR PLANS' : 'SORTED FOR YOU'}</span>
            </div>
            {hasResult && <button className="text-button trail-show-all" onClick={showAll}>Show all trails</button>}
            {sortMode === 'nearest' && !location.position && <div className="trail-sort-status">
              <p>Location is needed to sort by distance. Keeping recommendation order until a position is available.</p><LocationStatus id="trail-sort-location-status" location={location} showIdle={false} />
            </div>}
            {isCompact && <p className="list-hint">Tap a trail to find it on the map.</p>}
            {loadError && <p className="error-message" role="alert">{loadError}</p>}
            {cards.map(t => <TrailCard key={t.id} t={t} selected={t.id === selectedId} onSelect={() => selectFromCard(t.id)} onOfficialResources={() => openOfficialLibrary(t.id)} summary={summaries[t.id]} onReview={() => openReview(t)} reviewsVersion={reviewsVersion} fit={hasResult ? null : fitById[t.id]} proximityMeters={sortMode === 'nearest' ? distanceToTrail(t, location.position) : null} highlights={highlights[t.id]} />)}
            {cards.length === 0 && <div className="empty-state" role="status">{trailsLoading && !hasResult ? 'Loading trails…' : hasResult ? 'No trails matched this request. Try changing your preferences or browse all trails.' : 'No trails are available right now.'}</div>}
            </>}
          </section>}
        </section>
      </main>
      <Onboarding onSaved={() => setProfileVersion(v => v + 1)} />
      {reviewing && <ReviewModal trail={reviewing} checkin={finishing} badgeHint={activeCheckin?.trail_id !== reviewing.id} onClose={closeReview} onSaved={() => { refreshSummaries(); setReviewsVersion(v => v + 1) }}
        onCheckinDone={done => { if (done) { changeCheckin(null); setProfileVersion(v => v + 1) } else refreshCheckin() }} />}

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
