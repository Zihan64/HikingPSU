import { checkinTiming, formatClock } from './checkin'
import useNow from './useNow'

// Slim reminder under the header while a hike is checked in, on every page.
export default function ActiveCheckinBanner({ checkin, onFinish, onView }) {
  const now = useNow(30000, true, Date.parse(checkin.finish_after))
  const { canFinish, expired } = checkinTiming(checkin, now)
  const state = expired ? 'check-in expired' : canFinish ? 'ready to finish' : `finish after ${formatClock(checkin.finish_after, { ceil: true })}`
  return <section className="checkin-banner" aria-label="Your active hike">
    <p><b>On the trail:</b> {checkin.trail_name} · {state}</p>
    <div className="checkin-banner-actions">
      {onView && <button className="text-button" onClick={onView}>View trail</button>}
      {!expired && <button className="primary-button" disabled={!canFinish} onClick={onFinish}>Finish & rate</button>}
    </div>
  </section>
}
