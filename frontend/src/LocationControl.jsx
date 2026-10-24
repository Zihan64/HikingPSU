import { formatAccuracy } from './location'

// showStatus=false lets the page render <LocationStatus> elsewhere in the map information pane.
export default function LocationControl({ location, onRequest, onClear, onShowTrails, routeActive = false, showStatus = true }) {
  const busy = location.status === 'locating' || location.status === 'fallback'
  return (
    <div className={`location-control ${routeActive ? 'location-route' : ''}`} aria-label="Device location">
      <div className="location-actions">
        <button type="button" className="locate-button" onClick={onRequest} disabled={busy || location.tracking || location.status === 'unavailable'} aria-describedby={busy || location.position || location.error ? 'location-status' : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>
          <span>{busy ? 'Finding your location…' : location.tracking ? 'Live location active' : location.position ? 'Update my location' : 'Use my location'}</span>
        </button>
        {busy && <button className="text-button" type="button" onClick={location.cancel}>Cancel</button>}
        {location.tracking && !busy && !routeActive && <button className="text-button" type="button" onClick={location.stopTracking}>Stop live location</button>}
        {location.position && <button className="text-button" type="button" onClick={onClear}>Clear location</button>}
        <button className="text-button" type="button" onClick={onShowTrails}>{routeActive ? 'Show route' : 'Show trails'}</button>
      </div>
      {showStatus && <LocationStatus location={location} routeActive={routeActive} />}
    </div>
  )
}

export function LocationStatus({ location, routeActive = false, className = '', showIdle = true, id = 'location-status' }) {
  // Sidebar callers can omit the idle sentence, while existing callers keep the
  // main branch's status API and default message unchanged.
  if (!showIdle && !location.position && !location.error && !['locating', 'fallback'].includes(location.status)) return null
  return (
    <p id={id} className={`location-status ${className} ${location.error ? 'location-error' : ''}`} role="status" aria-live="polite" aria-atomic="true">
      {location.status === 'locating' ? 'Allow location when your browser asks. Requesting a high-accuracy position.'
        : location.status === 'fallback' ? 'High accuracy is unavailable. Trying a standard-accuracy position…'
          : location.position ? routeActive ? `Accuracy ±${formatAccuracy(location.position.accuracy)} · ${location.tracking ? 'Live updates while this page is visible.' : 'One-time fix; update as you move.'}` : `Location found · reported accuracy ±${formatAccuracy(location.position.accuracy)}. ${location.tracking ? 'Live updates while this page is visible; stop at any time.' : 'One-time fix; use Update as you move.'} Blue shading shows estimated accuracy.`
            : location.error || 'Optional · your permission is required. Explore trails without sharing your location.'}
    </p>
  )
}
