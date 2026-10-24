import { formatAccuracy } from './location'

export default function LocationControl({ location, onRequest, onClear, onShowTrails, routeActive = false }) {
  const busy = location.status === 'locating' || location.status === 'fallback'
  const status = location.status === 'locating' ? 'Finding your position…'
    : location.status === 'fallback' ? 'Retrying with standard accuracy…'
      : location.position ? `Accuracy ±${formatAccuracy(location.position.accuracy)} · ${location.tracking ? 'Live' : 'One-time fix'}`
        : location.error
  return (
    <div className={`location-control ${routeActive ? 'location-route' : ''}`} aria-label="Device location">
      <div className="location-actions">
        <button type="button" className="locate-button" onClick={onRequest} disabled={busy || location.tracking || location.status === 'unavailable'} aria-describedby={status ? 'location-status' : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>
          <span>{busy ? 'Finding your location…' : location.tracking ? 'Live location active' : location.position ? 'Update my location' : 'Use my location'}</span>
        </button>
        {busy && <button className="text-button" type="button" onClick={location.cancel}>Cancel</button>}
        {location.tracking && !busy && !routeActive && <button className="text-button" type="button" onClick={location.stopTracking}>Stop live location</button>}
        {location.position && <button className="text-button" type="button" onClick={onClear}>Clear location</button>}
        <button className="text-button" type="button" onClick={onShowTrails}>{routeActive ? 'Show route' : 'Show trails'}</button>
      </div>
      {status && <p id="location-status" className={`location-status ${location.error ? 'location-error' : ''}`} role="status" aria-live="polite" aria-atomic="true">{status}</p>}
    </div>
  )
}
