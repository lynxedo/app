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
  // Answer / reject a pending incoming call from the in-app overlay (Android —
  // no system call UI, so the web overlay drives these). Optional: present only
  // on builds that support it.
  acceptCall?(): Promise<void>
  rejectCall?(): Promise<void>
  setMuted(opts: { muted: boolean }): Promise<{ muted: boolean }>
  setOnHold(opts: { onHold: boolean }): Promise<{ onHold: boolean }>
  // Audio output routing (native only — the OS owns this, WKWebView can't).
  // Gated behind the 'audio-route' capability so the web control stays hidden
  // until a route-capable app build is installed.
  setAudioRoute(opts: { route: NativeAudioRoute }): Promise<{ route: NativeAudioRoute }>
  getAudioRoutes(): Promise<NativeAudioRouteState>
  // Re-attach (optional — present only on builds that support it). The JS dialer
  // calls this on mount to rebuild its in-call state for a call that's already
  // live (e.g. answered from the lock-screen notification, which reloads the
  // webview and misses the live callConnected event). Without it Hold/Transfer/
  // Record stay dark because the conference room was never (re)fetched.
  getActiveCall?(): Promise<{
    active: boolean
    ringing?: boolean
    callSid?: string
    from?: string
    muted?: boolean
    onHold?: boolean
    startedAtMs?: number
  }>
  addListener(
    eventName:
      | 'registered'
      | 'registrationFailed'
      | 'incomingCall'
      | 'callConnected'
      | 'callDisconnected'
      | 'callRinging'
      | 'callHold'
      | 'callHoldFailed'
      | 'audioRouteChanged'
      | 'audioRouteFailed',
    listenerFunc: (data: Record<string, unknown>) => void
  ): Promise<{ remove: () => void }>
}

export type NativeAudioRoute = 'earpiece' | 'speaker' | 'bluetooth'

export interface NativeAudioRouteState {
  current: NativeAudioRoute
  routes: NativeAudioRoute[]
  bluetoothAvailable: boolean
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

// ── Android ──────────────────────────────────────────────────────────────────
//
// ⚠⚠ ANDROID NEVER ONCE USED THE NATIVE PHONE. Everything below this line exists
// because the check above — `window.Capacitor` — is permanently false on our
// pages on Android. The shell loads a local bootstrap page and then navigates to
// lynxedo.com; Android injects the Capacitor bridge only into its own local
// origin, while iOS injects it as a user script that survives onto remote pages.
//
// So from June 2026 the iPhone got the real native phone and every Android phone
// silently fell back to WebRTC inside the webview — no telephony audio session,
// no proper Bluetooth hold, and throttled like any background web page. It
// surfaced as calls turning choppy about thirty seconds in, reported as having
// been that way for as long as the app had been used. Nothing looked broken
// anywhere: the native code was present, compiled and shipped, and the website
// quietly decided not to call it.
//
// ⚠ The native call path itself is NOT duplicated here. MainActivity exposes the
// same TwilioVoiceManager through a JavascriptInterface, the way every other
// Android feature in this app is exposed. This adapter only changes the SHAPE —
// a synchronous interface wrapped to look like the Capacitor plugin — so the
// dialer hook, which is already written for Android, needs no change at all.

type AndroidVoiceBridge = {
  getVersion(): string
  register(accessToken: string): void
  unregister(): void
  /** '' on success, otherwise a short line to show the person. */
  connect(accessToken: string, paramsJson: string): string
  disconnect(): void
  acceptCall(): void
  rejectCall(): void
  setMuted(muted: boolean): void
  setOnHold(onHold: boolean): void
  setAudioRoute(route: string): void
  getAudioRoutes(): string
  getActiveCall(): string
}

function androidBridge(): AndroidVoiceBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { LynxedoVoice?: AndroidVoiceBridge }).LynxedoVoice
}

type VoiceEvent = { event: string; data: Record<string, unknown> }
type Listener = (data: Record<string, unknown>) => void

const androidListeners = new Map<string, Set<Listener>>()
let androidSinkInstalled = false

/** The native side calls this by name. Installed once, on first listener. */
function installAndroidSink() {
  if (androidSinkInstalled || typeof window === 'undefined') return
  androidSinkInstalled = true
  ;(window as unknown as { __lynxedoVoiceEvent?: (e: VoiceEvent) => void }).__lynxedoVoiceEvent =
    (e: VoiceEvent) => {
      const set = androidListeners.get(e?.event)
      if (!set) return
      // ⚠ Copy before iterating: a listener that removes itself mid-dispatch
      // would otherwise mutate the set we are walking.
      for (const fn of [...set]) {
        try { fn(e.data ?? {}) } catch (err) { console.error('[native-voice] listener threw:', err) }
      }
    }
}

function parse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T } catch { return fallback }
}

/** Wrap the synchronous Android interface in the plugin's promise shape. */
function androidAdapter(b: AndroidVoiceBridge): NativeVoicePlugin {
  return {
    getVersion: async () =>
      parse(b.getVersion(), { version: '0', platform: 'android', capabilities: [] as string[] }),
    register: async ({ accessToken }) => { b.register(accessToken); return { registered: true } },
    unregister: async () => { b.unregister() },
    connect: async ({ accessToken, params }) => {
      // ⚠ A refusal comes back as a MESSAGE, not a throw — most often the
      // microphone, which would otherwise connect a silent call that sounds
      // exactly like a bad line. Reject so the dialer shows it.
      const err = b.connect(accessToken, JSON.stringify(params ?? {}))
      if (err) throw new Error(err)
      return { connected: true }
    },
    disconnect: async () => { b.disconnect() },
    acceptCall: async () => { b.acceptCall() },
    rejectCall: async () => { b.rejectCall() },
    setMuted: async ({ muted }) => { b.setMuted(muted); return { muted } },
    setOnHold: async ({ onHold }) => { b.setOnHold(onHold); return { onHold } },
    setAudioRoute: async ({ route }) => { b.setAudioRoute(route); return { route } },
    getAudioRoutes: async () =>
      parse<NativeAudioRouteState>(b.getAudioRoutes(),
        { current: 'earpiece', routes: ['earpiece'], bluetoothAvailable: false }),
    getActiveCall: async () => parse(b.getActiveCall(), { active: false }),
    addListener: async (eventName, listenerFunc) => {
      installAndroidSink()
      const set = androidListeners.get(eventName) ?? new Set<Listener>()
      set.add(listenerFunc as Listener)
      androidListeners.set(eventName, set)
      return { remove: () => { set.delete(listenerFunc as Listener) } }
    },
  }
}

// ── What the dialer asks ─────────────────────────────────────────────────────

/** True when a native Twilio Voice path is reachable — the Capacitor plugin on
 *  iOS, or the JavascriptInterface on Android. */
export function nativeVoiceAvailable(): boolean {
  const c = capacitor()
  if (c?.isNativePlatform?.() && c.Plugins?.TwilioVoice) return true
  return !!androidBridge()
}

/** The native plugin, or null if not running natively. */
export function getNativeVoice(): NativeVoicePlugin | null {
  const c = capacitor()
  if (c?.isNativePlatform?.() && c.Plugins?.TwilioVoice) return c.Plugins.TwilioVoice
  const b = androidBridge()
  return b ? androidAdapter(b) : null
}

/** 'ios' | 'android' when running natively, else null. Used to request a token
 *  carrying the right push-credential SID for incoming VoIP push.
 *  ⚠ Android answers from the interface, never from Capacitor — asking Capacitor
 *  there returns null, which would mint a token with no Android push credential
 *  and leave incoming calls silently unregistered. */
export function nativePlatform(): string | null {
  if (androidBridge()) return 'android'
  const c = capacitor()
  if (!c?.isNativePlatform?.()) return null
  return c.getPlatform?.() ?? null
}
