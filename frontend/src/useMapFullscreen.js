import { useEffect } from 'react'

// Expand the existing map to the browser viewport; keep its instance and camera.
// Background controls are inert, Escape closes, and Tab stays inside the map.
export default function useMapFullscreen(expanded, onExit, panelRef, buttonRef, shellRef) {
  useEffect(() => {
    if (!expanded) return
    const previousFocus = document.activeElement
    const background = [...shellRef.current.querySelectorAll('.app-header, .checkin-banner, .planner, .trail-list, .route-sidebar, .mobile-navigation, .library-workspace')]
    const previousInert = background.map(el => el.inert)
    background.forEach(el => { el.inert = true })
    buttonRef.current?.focus({preventScroll:true})
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onExit(); return }
      if (event.key !== 'Tab') return
      const controls = [...panelRef.current.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
        .filter(el => el.getClientRects().length && !el.closest('[hidden], [inert]'))
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); panelRef.current.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      background.forEach((el, i) => { el.inert = previousInert[i] })
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true})
    }
  }, [expanded, onExit, panelRef, buttonRef, shellRef])
}
