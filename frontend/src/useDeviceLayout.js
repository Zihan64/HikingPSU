import { useCallback, useSyncExternalStore } from 'react'

// Keep the layout breakpoint in sync with index.css. Capability queries also
// support tablets, touch laptops, resized windows and external displays.
function useMediaQuery(query) {
  const subscribe = useCallback(onChange => {
    const media = window.matchMedia(query)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export default function useDeviceLayout() {
  return {
    isCompact: useMediaQuery('(width < 960px)'),
    isTouch: useMediaQuery('(any-pointer: coarse)'),
    reducedMotion: useMediaQuery('(prefers-reduced-motion: reduce)'),
  }
}
