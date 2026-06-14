// Shared idle-tracking constants for HubIdleTracker and HubRootRedirect.
// Both components write/read these localStorage keys and compare against this
// threshold — any change here propagates to both automatically.
export const HUB_IDLE_THRESHOLD_MS = 14 * 60 * 60 * 1000 // 14 hours
export const HUB_LAST_ACTIVE_KEY = 'hub_last_active_at'
export const HUB_LAST_ROUTE_KEY = 'hub_last_route'
