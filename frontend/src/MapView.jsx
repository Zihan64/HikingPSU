import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'

// Fix default marker icons under Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export default function MapView({ trails }) {
  return (
    <MapContainer center={[40.78, -77.85]} zoom={11} className="h-72 w-full rounded-xl">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      {trails.map(t => (
        <Marker key={t.id} position={[t.trailhead.lat, t.trailhead.lon]}>
          <Popup><b>{t.name}</b><br />Level {t.difficulty.level} · {t.trailhead.address}</Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
