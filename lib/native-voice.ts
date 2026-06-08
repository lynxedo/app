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
  // `capabilities` lets the web feature-detect what the installed app build
  // supports (e.g. 'hold'), so web UI can ship ahead of / independently of a
  // native rebuild without exposing controls the native plugin can't honor.
  getVersion(): Promise<{ version: string; platform: string; capabilities?: string[] }>
  register(opts: { accessToken: string }): Promise<{ registered: boolean }>
  unregister(): Promise<void>
  connect(opts: { accessToken: string; params?: Record<string, string> }): Promise<{
    connected: boolean
    callSid?: string
  }>
  disconnect(): Promise<void>
  setMuted(opts: { muted: boolean }): Promise<{ muted: boolean }>
  setOnHold(opts: { onHold: boolean }): Promise<{ onHold: boolean }>
  addListener(
    eventName:
      | 'registered'
      | 'registrationFailed'
      | 'incomingCall'
      | 'callConnected'
      | 'callDisconnected'
      | 'callRinging'
      | 'callHold'
      | 'callHoldFailed',
    listenerFunc: (data: Record<string, unknown>) => void
  ): Promise<{ remove: () => void }>
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
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

/** 'ios' | 'android' when running natively, else null. Used to request a token
 *  carrying the right push-credential SID for incoming VoIP push. */
export function nativePlatform(): string | null {
  const c = capacitor()
  if (!c?.isNativePlatform?.()) return null
  return c.getPlatform?.() ?? null
}
