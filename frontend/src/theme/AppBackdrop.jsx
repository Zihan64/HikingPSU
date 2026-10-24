import OutdoorScene from '../scene/OutdoorScene'
import { Flocks } from '../scene/Wildlife'
import './theme.css'

// The same realistic world as the sign-in page, fixed behind the app: sun and crepuscular rays,
// cumulus and distant birds above; ridges, autumn forest, meadow and river below.
// Decorative only and behind every panel, so no widget changes size or behaviour.
// (The equipped hiker walks the header line, see HeaderTrail.jsx, where nothing covers him.)

const layout = (w, h) => {
  const land = Math.min(340, Math.max(200, h * 0.30))
  return { horizon: land / h, sun: [w < 640 ? 0.82 : 0.76, 1 - Math.min(90, h * 0.1) / h] }
}

export default function AppBackdrop() {
  return (
    <div className="hp-backdrop" aria-hidden="true">
      <OutdoorScene className="absolute inset-0" layout={layout} fps={24} />
      <div className="hp-backdrop-shade" />
      <div className="absolute inset-x-0 top-0 h-[45%]">
        <Flocks />
      </div>
    </div>
  )
}
