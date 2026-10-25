// Legacy unauthenticated entry retired. Never serve source files without the gateway.
export default function retiredBadgeLabConfig() {
  throw new Error('Badge Lab cannot be built or deployed with the legacy config. Use build:devtools and the authenticated developer gateway.')
}
