import { useEffect, useRef } from 'react'
import { createOutdoorScene } from './engine'
import './scene.css'

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/**
 * Realistic sky-and-forest scene on a canvas (WebGL2). Falls back to a CSS gradient.
 *   layout(width, height) -> { horizon, sun: [x, y] }   in CSS px, called on every resize
 *   interactive            -> pointer parallax (sign-in page)
 */
export default function OutdoorScene({ className = '', layout, interactive = false, fps, scale }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const still = prefersReducedMotion()
    const small = window.innerWidth < 700
    const scene = createOutdoorScene(canvas, {
      scale: scale ?? (small ? 0.6 : 0.5),
      fps: fps ?? (small ? 24 : 30),
      animate: !still,
      layout,
    })
    if (!scene) { canvas.dataset.fallback = '1'; return }

    let onMove
    if (interactive && !still) {
      onMove = e => scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1)
      window.addEventListener('pointermove', onMove, { passive: true })
    }
    return () => {
      if (onMove) window.removeEventListener('pointermove', onMove)
      scene.destroy()
    }
    // layout is read on every resize inside the engine; the scene itself is created once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={canvasRef} className={`hp-scene ${className}`} aria-hidden="true" />
}
