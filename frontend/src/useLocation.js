import { useEffect, useState, useSyncExternalStore } from 'react'
import { createLocationController } from './location'

export default function useLocation() {
  const [controller] = useState(() => createLocationController({
    geolocation: navigator.geolocation,
    permissions: navigator.permissions,
    secureContext: window.isSecureContext,
    policyAllowed: (document.permissionsPolicy || document.featurePolicy)?.allowsFeature('geolocation') ?? true,
  }))
  useEffect(() => controller.connect(), [controller])
  useEffect(() => {
    const pause = () => { if (document.hidden) controller.stopTracking() }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [controller])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  return { ...state, request: controller.request, cancel: controller.cancel, clear: controller.clear, startTracking: controller.startTracking, stopTracking: controller.stopTracking }
}
