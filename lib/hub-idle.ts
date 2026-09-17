// Shared idle-tracking constants for HubIdleTracker and HubRootRedirect.
// Both components write/read these localStorage keys and compare against this
// threshold — any change here propagates to both automatically.
export const HUB_IDLE_THRESHOLD_MS = 14 * 60 * 60 * 1000 // 14 hours
export const HUB_LAST_ACTIVE_KEY = 'hub_last_active_at'
export const HUB_LAST_ROUTE_KEY = 'hub_last_route'

// ── Where a stale session lands ────────────────────────────────────────────────
// Ben's call, June 29 2026, unshipped until now: on a phone, coming back after a
// long break should land on the day's work, not on a home screen. /hub/home is a
// page nobody navigates to on purpose — the sidebar is how people move around the
// Hub — so sending a crew member there each morning costs them a tap to get to the
// thing they actually opened the app for.
//
// ⚠ Mobile only, and "mobile" here means the native app rather than a narrow
// window: this is a crew-in-a-truck behaviour, and an office person who happens to
// have a narrow browser should not have their morning rearranged. Desktop keeps
// /hub/home.
//
// ⚠⚠ TWO CALLERS, ONE RULE. HubIdleTracker (already inside the Hub) and
// HubRootRedirect (landing on the bare /hub URL) both make this decision and MUST
// agree — they already share the constants above for the same reason. Change the
// rule here, not in either component.
// ⚠⚠ BOTH halves are required, and this cost a real bug: on ANDROID
// `window.Capacitor` does not exist on our pages at all. The shell loads a local
// bootstrap page and then navigates the webview to lynxedo.com, and Android only
// injects the Capacitor bridge into its own local origin — iOS injects it as a
// user script, so it survives onto remote pages. Proven on the connected Pixel:
// window.Capacitor was undefined while localStorage.lynxedo_native was "1".
//
// So a Capacitor-only check is silently false on every Android phone, and anything
// gated on it never runs there. `lynxedo_native` is set by the native-redirect page
// and re-set by MainActivity on every lynxedo page load. The login page has used
// exactly this pair since the shells were built — follow it, don't invent a third.
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return 'Capacitor' in window || window.localStorage.getItem('lynxedo_native') === '1'
  } catch {
    return false
  }
}

export function staleLandingRoute(canAccessDailyLog: boolean, fallback: string): string {
  if (!isNativeApp()) return '/hub/home'
  if (canAccessDailyLog) return '/hub/daily-log'
  // No Daily Log access — the general room is more use than an empty home screen.
  return fallback
}
