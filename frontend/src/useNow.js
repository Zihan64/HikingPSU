import { useEffect, useState } from 'react'

// Current time in ms, refreshed every `intervalMs` while `active` (and when the tab becomes visible again).
// `wakeAt` (ms timestamp, optional): also refresh right at that moment, e.g. when a check-in becomes finishable.
export default function useNow(intervalMs = 30000, active = true, wakeAt = null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const onVisible = () => { if (!document.hidden) tick() }
    tick()
    const id = setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [intervalMs, active])
  useEffect(() => {
    const ms = wakeAt - Date.now()
    if (!active || !Number.isFinite(ms) || ms <= 0) return
    const id = setTimeout(() => setNow(Date.now()), Math.min(2 ** 31 - 1, ms + 50))
    return () => clearTimeout(id)
  }, [active, wakeAt])
  return now
}
