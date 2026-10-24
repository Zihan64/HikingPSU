import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'

function Camera({trail, lines}) {
  const map = useMap()
  useEffect(() => {
    const resize = () => map.invalidateSize({animate:false})
    const observer = new ResizeObserver(resize)
    observer.observe(map.getContainer())
    const frame = requestAnimationFrame(() => {
      resize()
      if (lines.length) map.fitBounds(L.latLngBounds(lines.flat()), {padding:[25,25], maxZoom:16, animate:false})
      else map.setView([trail.trailhead.lat, trail.trailhead.lon], 14, {animate:false})
    })
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [map, trail, lines])
  return null
}

export default function TrailMap({trail, geometry}) {
  const lines = useMemo(() => (geometry?.lines || (geometry?.line ? [geometry.line] : []))
    .map(line => line.map(([lon, lat]) => [lat, lon])), [geometry])
  return <MapContainer center={[trail.trailhead.lat, trail.trailhead.lon]} zoom={14} scrollWheelZoom touchZoom className="catalog-map" aria-label={`Map of ${trail.name}`}>
    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
    <Camera trail={trail} lines={lines} />
    {lines.map((line, i) => <Polyline key={i} positions={line} pathOptions={{color:'#2f6b47', weight:5}} />)}
    <CircleMarker center={[trail.trailhead.lat, trail.trailhead.lon]} radius={7} pathOptions={{color:'#fff', weight:3, fillColor:'#2563eb', fillOpacity:1}}><Popup>Trailhead · {trail.trailhead.address}</Popup></CircleMarker>
  </MapContainer>
}
