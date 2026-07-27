/**
 * Desktop-vs-mobile heuristic (userAgent based). Returns true ONLY for real
 * desktop browsers — false for iPhone / iPad / iPod / Android and in any
 * non-browser / SSR context (no `navigator`).
 *
 * Shared source of truth for two features so they can never drift apart:
 *  - the Dialer Headset-mode default (`hooks/use-twilio-device.ts`), and
 *  - the Workspace Tabs desktop gate (`components/hub/workspace/…`).
 *
 * NOT an Electron / Capacitor / native check — for that use
 * `nativeVoiceAvailable()` / `nativePlatform()` from `@/lib/native-voice`.
 */
export function isDesktopEnvironment(): boolean {
  if (typeof navigator === 'undefined') return false
  return !/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
}
