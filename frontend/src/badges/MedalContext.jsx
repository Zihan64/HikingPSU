import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { getBadges } from '../api'
import { useOptionalToken } from '../auth'
import MedalUnlocked from './MedalUnlocked'

// Keeps the signed-in hiker's medals. After anything that can earn one (a review, a logged hike),
// call refreshMedals(): newly earned medals are celebrated one at a time.

export const MEDAL_NAMES = {
  trailhead: 'Trailhead', 'valley-walker': 'Valley Walker', 'ridge-walker': 'Ridge Walker', summit: 'Summit',
  'seven-mountains': 'Seven Mountains', 'allegheny-front': 'Allegheny Front', explorer: 'Happy Valley Explorer',
  'car-free': 'Car-free', 'four-seasons': 'Four Seasons', 'trail-guide': 'Trail Guide',
}

const MedalCtx = createContext({ medals: null, refreshMedals: async () => {}, setWallOpener: () => {} })

export function useMedals() { return useContext(MedalCtx) }

export function MedalProvider({ children }) {
  const { isAuthenticated } = useAuth0()
  const getToken = useOptionalToken()
  const [medals, setMedals] = useState(null)
  const [queue, setQueue] = useState([])
  const known = useRef(null)   // ids earned at the last fetch; null until the first one
  const opener = useRef(null)  // set by the app: opens the profile page with the medal case
  const setWallOpener = useCallback(fn => { opener.current = fn }, [])

  const refreshMedals = useCallback(async ({ celebrate = true } = {}) => {
    const token = await getToken()
    if (!token) { setMedals(null); known.current = null; return null }
    try {
      const data = await getBadges(token)
      const earned = new Set(data.badges.filter(b => b.earned).map(b => b.id))
      if (celebrate && known.current) {
        const fresh = data.badges.filter(b => b.earned && !known.current.has(b.id)).sort((a, b) => a.rank - b.rank)
        if (fresh.length) setQueue(q => [...q, ...fresh])
      }
      known.current = earned
      setMedals(data)
      return data
    } catch { return null }  // medals are a bonus; never block the app over them
  }, [getToken])

  useEffect(() => {
    if (isAuthenticated) refreshMedals({ celebrate: false })
    else { setMedals(null); known.current = null }
  }, [isAuthenticated, refreshMedals])

  return (
    <MedalCtx.Provider value={{ medals, refreshMedals, setWallOpener }}>
      {children}
      {queue.length > 0 && (
        <MedalUnlocked medal={queue[0]} more={queue.length - 1} onClose={() => setQueue(q => q.slice(1))}
          onSeeAll={() => { setQueue([]); opener.current?.() }} />
      )}
    </MedalCtx.Provider>
  )
}
