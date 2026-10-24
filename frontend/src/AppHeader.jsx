import AuthButton from './AuthButton'
import { Mark } from './landing/Logo'
import HeaderTrail from './theme/HeaderTrail'

export function HomeLink({ onHome, compact = false }) {
  return <a className={`brand ${compact ? 'brand-compact' : ''}`} href="#" aria-label="HikingPSU home" onClick={e => { e.preventDefault(); onHome() }}>
    <Mark className="brand-mark" />
    <span><span className="brand-name">HikingPSU</span>{!compact && <span className="brand-caption">A little closer to the outdoors.</span>}</span>
  </a>
}

export default function AppHeader({ onHome, onLibrary, libraryOpen = false, onCatalog, catalogOpen = false, onProfile, profileOpen = false, account }) {
  return <header className="app-header">
    <HomeLink onHome={onHome} />
    <div className="header-actions">
      <nav className="desktop-navigation" aria-label="Workspace"><button onClick={onHome} aria-pressed={!libraryOpen && !profileOpen && !catalogOpen}>Explore</button><button onClick={onCatalog} aria-pressed={catalogOpen}>Trails</button><button onClick={onLibrary} aria-pressed={libraryOpen}>Official library</button></nav>
      <span className="location-label"><span />Happy Valley, PA</span>
      <div className="auth-control">{account ?? <AuthButton onProfile={onProfile} profileActive={profileOpen} />}</div>
    </div>
    <HeaderTrail />
  </header>
}
