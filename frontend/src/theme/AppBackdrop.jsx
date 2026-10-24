import { ForestBand, SkyBand } from '../scenery/Scenery'
import { Flocks } from '../scenery/Wildlife'
import './theme.css'

// A quiet version of the sign-in landscape behind the app: a warm-blue sky strip with the sun,
// light shafts and drifting cloud at the top, soft forest ridges along the bottom, and a calm
// light surface in between so every card and line of text reads clearly.
// Decorative only and behind every panel, so no widget changes size or behaviour.

export default function AppBackdrop() {
  return (
    <div className="hp-backdrop" aria-hidden="true">
      <SkyBand />
      <div className="absolute inset-x-0 top-0 h-[260px] opacity-70"><Flocks /></div>
      <ForestBand />
    </div>
  )
}
