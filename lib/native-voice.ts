'use client'

// Bridge to the native Capacitor TwilioVoice plugin (iOS app).
//
// When the Hub runs inside the native app, outbound calls go through the native
// Twilio Voice SDK — so call audio uses the device's real telephony stack
// (lock screen, Bluetooth, and eventually CarPlay) instead of in-webview WebRTC,
// which WKWebView restricts. In a browser or the desktop app this module reports
// "unavailable" and the existing Twilio Voice JS SDK path is used unchanged.
//
// The plugin is reached through the global `window.Capacitor` bridge that the
// native shell injects into every page it loads (including lynxedo.com) — the
// website never bundles the plugin itself.

export interface NativeVoicePlugin {
  getVersion(): Promise<{ version: string; platform: string }>
  connect(opts: { accessToken: string; params?: Record<string, string> }): Promise<{
    connected: boolean
    callSid?: string
  }>
  disconnect(): Promise<void>
  setMuted(opts: { muted: boolean }): Promise<{ muted: boolean }>
  addListener(
    eventName:
      | 'registered'
      | 'registrationFailed'
      | 'incomingCall'
      | 'callConnected'
      | 'callDisconnected'
      | 'callRinging',
    listenerFunc: (data: Record<string, unknown>) => void
  ): Promise<{ remove: () => void }>
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  Plugins?: { TwilioVoice?: NativeVoicePlugin }
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
}

/** True only when running inside the native app AND the TwilioVoice plugin is present. */
export function nativeVoiceAvailable(): boolean {
  const c = capacitor()
  return !!(c?.isNativePlatform?.() && c.Plugins?.TwilioVoice)
}

/** The native plugin, or null if not running natively. */
export function getNativeVoice(): NativeVoicePlugin | null {
  return nativeVoiceAvailable() ? capacitor()!.Plugins!.TwilioVoice! : null
}
