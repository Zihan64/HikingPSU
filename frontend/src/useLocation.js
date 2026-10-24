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
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  return { ...state, request: controller.request, cancel: controller.cancel, clear: controller.clear }
}
