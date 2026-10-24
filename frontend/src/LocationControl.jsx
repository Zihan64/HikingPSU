import { formatAccuracy } from './location'

export default function LocationControl({ location, onRequest, onClear, onShowTrails }) {
  const busy = location.status === 'locating' || location.status === 'fallback'
  return (
    <div className="location-control" aria-label="Device location">
      <div className="location-actions">
        <button type="button" className="locate-button" onClick={onRequest} disabled={busy || location.status === 'unavailable'} aria-describedby="location-description location-status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>
          <span>{busy ? 'Finding your location…' : location.position ? 'Update my location' : 'Use my location'}</span>
        </button>
        {busy && <button className="text-button" type="button" onClick={location.cancel}>Cancel</button>}
        {location.position && <button className="text-button" type="button" onClick={onClear}>Clear location</button>}
        <button className="text-button" type="button" onClick={onShowTrails}>Show trails</button>
      </div>
      <p id="location-description" className="location-description">Your browser may use GPS, Wi-Fi or cellular location. Location stays on this page; map tiles are loaded for the area you view.</p>
      <p id="location-status" className={`location-status ${location.error ? 'location-error' : ''}`} role="status" aria-live="polite" aria-atomic="true">
        {location.status === 'locating' ? 'Allow location when your browser asks. Requesting a high-accuracy position.'
          : location.status === 'fallback' ? 'High accuracy is unavailable. Trying a standard-accuracy position…'
            : location.position ? `Location found · reported accuracy ±${formatAccuracy(location.position.accuracy)}. Blue shading shows the estimated accuracy area. This is a one-time fix; use Update as you move.`
              : location.error || 'Optional · your permission is required. Explore trails without sharing your location.'}
      </p>
    </div>
  )
}
