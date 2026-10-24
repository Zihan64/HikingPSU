import { Birds, Clouds, Landscape, Sun } from '../landing/SkyScene'
import '../landing/landing.css'
import './theme.css'

// The same outdoor world as the sign-in page, fixed behind the app: sun, clouds and birds
// in the sky; ridges, a river, a stream and forest along the bottom. Decorative only, behind
// every panel, so no widget changes size or behaviour. (The walking hiker lives on the header
// line, see HeaderTrail.jsx, where nothing covers him.)
export default function AppBackdrop() {
  return (
    <div className="hp-backdrop" aria-hidden="true">
      <Sun className="right-[4%] top-[-70px] scale-75 sm:right-[18%]" />
      <div className="hp-backdrop-sky"><Clouds /><Birds /></div>
      <Landscape className="hp-backdrop-land" rise={false} />
    </div>
  )
}
