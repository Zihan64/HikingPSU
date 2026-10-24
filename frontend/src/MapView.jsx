import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { LEVEL_HEX } from './levels'

const DEFAULT_CENTER = [40.78, -77.85]
const DEFAULT_ZOOM = 11

// Keep the map within 60 km of State College (square bounds that contain the 60 km circle).
const MAX_RADIUS_M = 60000
const MAX_BOUNDS = L.latLng(DEFAULT_CENTER).toBounds(MAX_RADIUS_M * 2)
const MIN_ZOOM = 9

// Pin = colored circle with the difficulty level inside.
// emphasis: 'normal' | 'rec' (recommended by the agent) | 'selected'
const iconCache = {}
function levelIcon(level, emphasis, largeTargets) {
  const key = `${level}-${emphasis}-${largeTargets}`
  if (!iconCache[key]) {
    const size = emphasis === 'normal' ? 26 : 34
    const target = largeTargets ? 44 : size
    const shadow = emphasis === 'selected' ? '0 0 0 3px #1c1917' : '0 1px 4px rgba(0,0,0,.45)'
    iconCache[key] = L.divIcon({
      className: '',
      html: `<div style="width:${target}px;height:${target}px;display:grid;place-items:center"><div style="width:${size}px;height:${size}px;border-radius:50%;background:${LEVEL_HEX[level]};border:3px solid #fff;box-shadow:${shadow};color:#fff;font:700 ${size > 30 ? 14 : 12}px system-ui,sans-serif;display:flex;align-items:center;justify-content:center">${level}</div></div>`,
      iconSize: [target, target],
      iconAnchor: [target / 2, target / 2],
      popupAnchor: [0, -size / 2],
    })
  }
  return iconCache[key]
}

// Several trails share one trailhead (e.g. both Mt. Nittany loops). Fan them out in a
// small circle (~90 m) so every pin stays clickable. The popup still shows the real address.
function spreadPositions(trails) {
  const groups = {}
  for (const t of trails) {
    const k = `${t.trailhead.lat.toFixed(4)},${t.trailhead.lon.toFixed(4)}`
    ;(groups[k] ||= []).push(t)
  }
  const out = {}
  for (const group of Object.values(groups)) {
    group.forEach((t, i) => {
      if (group.length === 1) {
        out[t.id] = [t.trailhead.lat, t.trailhead.lon]
      } else {
        const angle = (2 * Math.PI * i) / group.length
        out[t.id] = [t.trailhead.lat + 0.0008 * Math.sin(angle), t.trailhead.lon + 0.001 * Math.cos(angle)]
      }
    })
  }
  return out
}

// Moves the camera: fit the recommended trails, else fit everything; fly to a selected one.
function Camera({ trails, positions, recIds, selectedId, active, reducedMotion, compact, userPosition, mapFocus }) {
  const map = useMap()
  const recKey = recIds.join(',')
  const boundsKey = recKey || trails.map(t => t.id).join(',')
  const fittedKey = useRef(null)
  const appliedFocus = useRef(null)

  // Preserve the local trail browsing bounds, while allowing a requested user
  // location outside the region to be shown. Show trails restores the bounds.
  useEffect(() => {
    const showingLocation = mapFocus.kind === 'location' && userPosition
    map.setMaxBounds(showingLocation ? null : MAX_BOUNDS)
    map.setMinZoom(showingLocation ? Math.min(8, MIN_ZOOM) : MIN_ZOOM)
  }, [map, mapFocus.kind, userPosition])

  useEffect(() => {
    if (!active) appliedFocus.current = null
  }, [active])

  // Closing a desktop popup explicitly prevents an empty Leaflet popup shell
  // from surviving when its React content unmounts for the mobile detail panel.
  useEffect(() => {
    if (compact) map.closePopup()
  }, [map, compact])

  useEffect(() => {
    if (!active) return
    let frame
    const resize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: true, animate: false }))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(map.getContainer())
    resize()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [map, active])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ pan: true, animate: false })
      const p = selectedId && positions[selectedId]
      const focusKey = `${mapFocus.kind}-${mapFocus.version}-${mapFocus.kind === 'location' ? userPosition?.id : ''}`
      const freshFocus = appliedFocus.current !== focusKey
      if (mapFocus.kind === 'location' && userPosition && freshFocus) {
        const zoom = userPosition.accuracy <= 100 ? 16 : userPosition.accuracy <= 1000 ? 14 : userPosition.accuracy <= 10000 ? 11 : 8
        map.closePopup()
        map.setView([userPosition.latitude, userPosition.longitude], zoom, { animate: !reducedMotion, duration: 0.4 })
        appliedFocus.current = focusKey
      } else if (mapFocus.kind === 'trail' && p && freshFocus) {
        map.setView(p, Math.max(map.getZoom(), 13), { animate: !reducedMotion, duration: 0.4 })
        appliedFocus.current = focusKey
      } else if (mapFocus.kind === 'trails' && (freshFocus || fittedKey.current !== boundsKey)) {
        const ids = recKey ? recKey.split(',') : trails.map(t => t.id)
        const pts = ids.map(id => positions[id]).filter(Boolean)
        if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: recKey ? 13 : 12, animate: false })
        else map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
        appliedFocus.current = focusKey
      }
      fittedKey.current = boundsKey
    })
    return () => cancelAnimationFrame(frame)
  }, [map, active, boundsKey, recKey, trails, positions, selectedId, reducedMotion, userPosition, mapFocus])

  return null
}

export default function MapView({ trails, recIds = [], selectedId = null, onSelect = () => {}, active = true, touch = false, compact = false, reducedMotion = false, userPosition = null, mapFocus = { kind: 'trails', version: 0 } }) {
  const positions = useMemo(() => spreadPositions(trails), [trails])
  const markerRefs = useRef({})

  useEffect(() => {
    if (active && selectedId && !compact) markerRefs.current[selectedId]?.openPopup()
  }, [active, selectedId, compact])

  const hasRec = recIds.length > 0

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} minZoom={MIN_ZOOM} maxBounds={MAX_BOUNDS} maxBoundsViscosity={1.0} scrollWheelZoom={false} className="trail-map" aria-label="Interactive map of local trails">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      <Camera trails={trails} positions={positions} recIds={recIds} selectedId={selectedId} active={active} reducedMotion={reducedMotion} compact={compact} userPosition={userPosition} mapFocus={mapFocus} />
      {userPosition && <>
        <Circle center={[userPosition.latitude, userPosition.longitude]} radius={userPosition.accuracy} pathOptions={{ color: '#2563eb', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.12 }} interactive={false} />
        <CircleMarker center={[userPosition.latitude, userPosition.longitude]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }} interactive={false}>
          <Tooltip permanent direction="top" offset={[0, -10]}>Your location</Tooltip>
        </CircleMarker>
      </>}
      {trails.map(t => {
        const isSel = t.id === selectedId
        const isRec = recIds.includes(t.id)
        const emphasis = isSel ? 'selected' : isRec ? 'rec' : 'normal'
        return (
          <Marker
            key={t.id}
            ref={el => { markerRefs.current[t.id] = el }}
            position={positions[t.id]}
            icon={levelIcon(t.difficulty.level, emphasis, touch || compact)}
            title={`${t.name}, Level ${t.difficulty.level}`}
            alt={`${t.name}, Level ${t.difficulty.level}`}
            opacity={hasRec && !isRec && !isSel ? 0.4 : 1}
            zIndexOffset={isSel ? 2000 : isRec ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(t.id) }}
          >
            {!compact && <Popup>
              <b>{t.name}</b>
              <br />
              L{t.difficulty.level} {t.difficulty.label} · {t.distance_mi} mi
              <br />
              <span style={{ color: '#78716c' }}>Trailhead: {t.trailhead.address}</span>
            </Popup>}
          </Marker>
        )
      })}
    </MapContainer>
  )
}
