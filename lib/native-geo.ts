'use client'

// One warm location fix, ready before anybody asks for it.
//
// ⚠⚠ THE RULE THAT MAKES THIS DIFFERENT from the version ripped out in June 2026:
// nothing here is ever awaited on a user action. We start warming a fix when a
// screen that might want one mounts, and the action takes whatever is already in
// hand. No fix yet means the punch goes without one — it never means the user
// waits. The old flow hung on iOS permission prompts and dead-ended on a denial
// precisely because the punch was gated on the answer; this cannot do that,
// because it never asks a question the user has to be present for.
//
// ⚠ Native goes through Capacitor's Geolocation plugin, not navigator.geolocation:
// WKWebView does not implement the web API for an embedded app at all (Safari
// does — an app's webview does not), which is why it "never resolved". Android's
// webview does implement it now that MainActivity answers the permission prompt,
// but routing both platforms through the plugin keeps one code path and one
// permission story.

export type Fix = { lat: number; lng: number; at: number }

type CapShape = {
  isNativePlatform?: () => boolean
  Plugins?: {
    Geolocation?: {
      getCurrentPosition(opts?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }):
        Promise<{ coords: { latitude: number; longitude: number } }>
    }
  }
}

function cap(): CapShape | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: CapShape }).Capacitor
}

function isNative(): boolean {
  const c = cap()
  return !!c?.isNativePlatform?.() && !!c.Plugins?.Geolocation
}

let fix: Fix | null = null
let inFlight = false

async function refresh(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const c = cap()
    if (isNative()) {
      // enableHighAccuracy false: a street-level fix is all a punch needs, and the
      // coarse one comes back far faster and costs much less battery.
      const pos = await c!.Plugins!.Geolocation!.getCurrentPosition({
        enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000,
      })
      fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() }
    } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
      // Only reachable if a caller asks for a fix explicitly — startWarmingLocation
      // never takes this path (see its note). Kept so a future opt-in web surface
      // has something to call.
      fix = await new Promise<Fix | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, at: Date.now() }),
          () => resolve(fix),                       // denied or timed out — keep whatever we had
          { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
        )
      })
    }
  } catch {
    // Denied, unavailable, or simply not ready. Deliberately silent: a missing fix
    // is a normal outcome here, not an error anybody needs to see.
  } finally {
    inFlight = false
  }
}

/** Begin warming a fix. Call on mount of any screen that might want one; the
 *  returned function stops the refresh. Safe to call from several screens at once.
 *
 *  ⚠⚠ NATIVE ONLY, on purpose. On the web this is a no-op: calling
 *  getCurrentPosition in a browser pops a location permission prompt, and the Hub
 *  home screen is where every office person lands every morning. Asking them for
 *  their location out of nowhere — to support a feature that only means anything
 *  in a truck — is exactly the small unexplained thing that makes people distrust
 *  an app. Desktop keeps today's behaviour: no prompt, no location on the punch. */
export function startWarmingLocation(): () => void {
  if (!isNative()) return () => {}
  void refresh()
  // Re-warm while the screen is up: somebody who opened the Hub at the shop and
  // clocks in at the first property should not be stamped at the shop.
  const t = setInterval(() => { void refresh() }, 60_000)
  return () => clearInterval(t)
}

/** The fix we already hold, or null. NEVER waits. `maxAgeMs` guards against
 *  stamping a punch with a position from somewhere the person no longer is. */
export function getWarmLocation(maxAgeMs = 5 * 60_000): { lat: number; lng: number } | null {
  if (!fix) return null
  if (Date.now() - fix.at > maxAgeMs) return null
  return { lat: fix.lat, lng: fix.lng }
}
