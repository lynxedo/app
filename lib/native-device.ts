'use client'

// Haptics and keep-awake — the two bits of "feel" a web page cannot do itself,
// and which split differently across our two platforms.
//
// ⚠⚠ THE SPLIT, and why it is not symmetrical:
//   • Haptics — Android's webview HAS navigator.vibrate and it works. iOS has no
//     Vibration API at all, so every vibrate() in the Hub is a silent no-op on an
//     iPhone. That is why nobody noticed: the thing "works" on the phone it was
//     tested on. iOS goes through the native plugin.
//   • Keep awake — NEITHER webview can do it. The Screen Wake Lock API is absent
//     on both, so both platforms need native help, by different doors.
//
// ⚠ The doors are different because the bridges are. iOS injects the Capacitor
// bridge as a user script, so it survives onto our remote lynxedo.com pages and
// window.Capacitor.Plugins is reachable. Android does NOT — window.Capacitor is
// undefined there — so the Android side is a plain JavascriptInterface that
// MainActivity attaches to the WebView itself. Same reasoning as lib/native-geo.

import { isNativeApp } from '@/lib/hub-idle'

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

type CapShape = {
  Plugins?: {
    DeviceFeel?: {
      haptic(opts: { style: HapticStyle }): Promise<void>
      setKeepAwake(opts: { on: boolean }): Promise<void>
    }
  }
}

/** The iOS plugin, when the bridge is actually reachable. On Android this is
 *  always undefined by design — see the note above. */
function iosPlugin() {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: CapShape }).Capacitor?.Plugins?.DeviceFeel
}

function androidScreen() {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { LynxedoScreen?: { setKeepAwake(on: boolean): void } }).LynxedoScreen
}

/** How long a web vibration should run for each haptic style. Only Android and
 *  desktop read these; iOS picks a real system feedback pattern instead, which
 *  is why the styles are named after intent rather than duration. */
const WEB_PATTERN: Record<HapticStyle, number | number[]> = {
  light:   10,
  medium:  20,
  heavy:   40,
  success: [15, 60, 15],
  warning: [25, 60, 25],
  error:   [40, 70, 40],
}

/** A short tap of feedback. Silent wherever the device has none — a missing
 *  buzz is never worth an error. */
export function haptic(style: HapticStyle = 'light'): void {
  try {
    const plugin = iosPlugin()
    if (plugin) { void plugin.haptic({ style }); return }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(WEB_PATTERN[style])
    }
  } catch {
    // Not supported, or blocked for want of a user gesture. Deliberately silent.
  }
}

/** How many screens are currently holding the screen awake. Refcounted because
 *  two can overlap — a route sheet open behind a Radio channel — and the first
 *  one to unmount must not switch the screen off underneath the other. */
let holds = 0

function applyKeepAwake(on: boolean): void {
  try {
    const plugin = iosPlugin()
    if (plugin) { void plugin.setKeepAwake({ on }); return }
    androidScreen()?.setKeepAwake(on)
  } catch {
    // No bridge on this build. Nothing to release either.
  }
}

/** Hold the screen on, and return the function that lets it sleep again.
 *
 *  ⚠ ALWAYS call the returned function — from a useEffect cleanup, so leaving the
 *  screen releases it. Nothing else will: on iOS isIdleTimerDisabled outlives the
 *  page that set it. (Android's window flag stops applying once the app is not in
 *  front, so a leak there is survivable; iOS is not so forgiving.)
 *
 *  ⚠⚠ NATIVE ONLY. On a desktop browser this is a no-op rather than a Screen Wake
 *  Lock request, which would pop a permission-ish prompt on a laptop that is
 *  never the problem this solves. */
export function keepAwake(): () => void {
  if (!isNativeApp()) return () => {}

  holds += 1
  if (holds === 1) applyKeepAwake(true)

  let released = false
  return () => {
    if (released) return          // a double cleanup must not drop someone else's hold
    released = true
    holds = Math.max(0, holds - 1)
    if (holds === 0) applyKeepAwake(false)
  }
}
