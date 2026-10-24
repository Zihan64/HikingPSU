import { useEffect, useState } from 'react'
import { formatMeters, locateOnRoute } from './trailGeometry'

function statusText(match) {
  if (match.status === 'no_position') return 'Use your location to see its relationship to the official route.'
  if (match.status === 'stale') return 'The last location is stale. Update your position before using along-route reference distances.'
  if (match.status === 'poor_accuracy') return 'Location accuracy is too low for along-route guidance. Check the accuracy circle and the official map.'
  if (match.status === 'off_route') return `Your reported position is about ${formatMeters(match.distanceToRouteMeters)} from the mapped route. Consult signs and the official map; no off-trail shortcut is suggested.`
  if (match.status === 'uncertain') return 'Your position relative to the route is uncertain. Confirm your location with the official map and on-site signs.'
  return `Near the mapped route · about ${formatMeters(match.distanceToRouteMeters)} from its centerline.`
}

export default function RouteReference({ data, reference, location, onLive, onReverse, onClose }) {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const match = locateOnRoute(reference, location.position, now)
  const near = match.status === 'near_route'
  return <section className="route-reference" aria-label="Official mapped-route reference">
    <div className="route-reference-title"><div><span className="eyebrow">OFFICIAL GEOMETRY · PLANNING REFERENCE</span><h2>{data.route.name}</h2><p>{formatMeters(reference.lengthMeters)} from GIS geometry · {data.route.activity}</p></div><button className="text-button" onClick={onClose} aria-label="Remove official route">×</button></div>
    <p className={`route-position-status ${near ? '' : 'position-unconfirmed'}`} role="status" aria-live="polite">{statusText(match)}</p>
    {near && reference.connected && <p className="reference-progress">Reference: {formatMeters(match.alongMeters)} of {formatMeters(reference.lengthMeters)} · {reference.loop ? 'loop' : `${formatMeters(match.remainingMeters)} remaining`}.</p>}
    <div className="route-reference-actions">
      <button className="text-button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>{expanded ? 'Hide route segments' : 'Route segments & sources'}</button>
      {!location.tracking ? <button className="text-button" onClick={onLive} disabled={location.status === 'unavailable'}>Follow my position</button> : <button className="text-button" onClick={location.stopTracking}>Stop live location</button>}
    </div>
    {expanded && <div className="route-reference-details">
      <p>{reference.connected ? 'These are manager-published segment names in connected geometry order. They are not official junction or turn instructions. Direction below is only the selected reference order.' : reference.reason}</p>
      {reference.loop && <p>The endpoint is a loop reference point, not an arrival signal. Position alone does not establish a completed circuit.</p>}
      {reference.connected && <><button className="text-button" onClick={onReverse}>Reverse reference order</button><ol>{reference.steps.map((step, i) => <li key={`${i}-${step.name}`} aria-current={near && match.stepIndex === i ? 'step' : undefined}><span aria-hidden="true">↑</span><div><strong>{step.name}</strong><span>{formatMeters(step.lengthMeters)} · mapped segment {i + 1}</span></div></li>)}</ol></>}
      <p>{data.route.description}</p><p className="source-notice">{data.source_notice}</p>
      <p className="source-manager">Source retrieved {new Date(data.retrieved_at).toLocaleString()} · {data.route.manager}</p>
      <a href={data.route.manager_url} target="_blank" rel="noopener noreferrer">Check manager notices and regulations ↗</a>
    </div>}
  </section>
}
