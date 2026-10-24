import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
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
function levelIcon(level, emphasis) {
  const key = `${level}-${emphasis}`
  if (!iconCache[key]) {
    const size = emphasis === 'normal' ? 26 : 34
    const shadow = emphasis === 'selected' ? '0 0 0 3px #1c1917' : '0 1px 4px rgba(0,0,0,.45)'
    iconCache[key] = L.divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${LEVEL_HEX[level]};border:3px solid #fff;box-shadow:${shadow};color:#fff;font:700 ${size > 30 ? 14 : 12}px system-ui,sans-serif;display:flex;align-items:center;justify-content:center">${level}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
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
function Camera({ trails, positions, recIds, selectedId }) {
  const map = useMap()
  const recKey = recIds.join(',')

  useEffect(() => {
    const ids = recIds.length ? recIds : trails.map(t => t.id)
    const pts = ids.map(id => positions[id]).filter(Boolean)
    if (pts.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
    } else {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: recIds.length ? 13 : 12 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey, trails.length])

  useEffect(() => {
    const p = selectedId && positions[selectedId]
    if (p) map.flyTo(p, Math.max(map.getZoom(), 13), { duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  return null
}

export default function MapView({ trails, recIds = [], selectedId = null, onSelect = () => {} }) {
  const positions = useMemo(() => spreadPositions(trails), [trails])
  const markerRefs = useRef({})

  useEffect(() => {
    if (selectedId) markerRefs.current[selectedId]?.openPopup()
  }, [selectedId])

  const hasRec = recIds.length > 0

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      minZoom={MIN_ZOOM}
      maxBounds={MAX_BOUNDS}
      maxBoundsViscosity={1.0}
      className="h-80 w-full rounded-xl"
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      <Camera trails={trails} positions={positions} recIds={recIds} selectedId={selectedId} />
      {trails.map(t => {
        const isSel = t.id === selectedId
        const isRec = recIds.includes(t.id)
        const emphasis = isSel ? 'selected' : isRec ? 'rec' : 'normal'
        return (
          <Marker
            key={t.id}
            ref={el => { markerRefs.current[t.id] = el }}
            position={positions[t.id]}
            icon={levelIcon(t.difficulty.level, emphasis)}
            opacity={hasRec && !isRec && !isSel ? 0.4 : 1}
            zIndexOffset={isSel ? 2000 : isRec ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(t.id) }}
          >
            <Popup>
              <b>{t.name}</b>
              <br />
              L{t.difficulty.level} {t.difficulty.label} · {t.distance_mi} mi
              <br />
              <span style={{ color: '#78716c' }}>Trailhead: {t.trailhead.address}</span>
            </Popup>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
