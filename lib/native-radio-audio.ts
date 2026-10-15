'use client'

// Radio's native audio session — the reason the app release exists.
//
// Radio's capture and playback stay in the page exactly as they are. What the app
// adds is that the page's audio runs inside the APP's audio session, and the app
// can put that session into two-way voice mode the way a phone call does. That
// buys the things Phase 0 proved a web page cannot have (Hub/HUB_RADIO_PRD.md):
//   • a Bluetooth earpiece that holds, in and out, instead of degrading after ~30s;
//   • audio that behaves like a call — ducks music, uses the call volume, and
//     (iOS) ignores the physical mute switch.
//
// ⚠⚠ The native half of this sat in both app builds from Sep 17 2026 with NOTHING
// calling it. This file is the missing web half. Same two-door shape as
// lib/native-voice.ts and lib/native-device.ts, for the same reason: iOS injects the
// Capacitor bridge as a user script that survives onto lynxedo.com, so the plugin is
// reachable there; Android does not, so the Android side is a plain
// JavascriptInterface that MainActivity attaches to the WebView. Neither door is a
// second implementation — each hands to the one native session.
//
// On a desktop browser, or an app build without the door, every call here is a
// quiet no-op and Radio behaves exactly as it did before.

export type RadioAudioState = {
  /** True while Radio owns the audio session. */
  active: boolean
  /** A Bluetooth headset is on the current route (in or out). */
  bluetooth: boolean
  /** Human-readable current route, e.g. "AirPods Pro". Empty when unknown. */
  output: string
  input: string
}

type RadioAudioEvent = 'interrupted' | 'routeChanged'
type Listener = (data: Record<string, unknown>) => void

type IosPlugin = {
  start(): Promise<RadioAudioState>
  stop(): Promise<void>
  getState(): Promise<RadioAudioState>
  /** ⚠ On our pages this is NOT a promise. The iOS app injects its own plugin stub
   *  (Capacitor's JSExport), whose addListener returns a plain { remove } object —
   *  only @capacitor/core, which we don't load, wraps it in a promise. Treat it as
   *  either; see onRadioAudioEvent. */
  addListener(eventName: RadioAudioEvent, fn: Listener): { remove: () => unknown } | Promise<{ remove: () => unknown }>
}

/** The Android door. Synchronous by nature (a JavascriptInterface); start() answers
 *  with the state as JSON, or {"error": "..."} when the native side declined. */
type AndroidBridge = {
  start(): string
  stop(): void
  getState(): string
}

function iosPlugin(): IosPlugin | undefined {
  if (typeof window === 'undefined') return undefined
  const cap = (window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { RadioAudio?: IosPlugin } }
  }).Capacitor
  if (!cap?.isNativePlatform?.()) return undefined
  return cap.Plugins?.RadioAudio
}

function androidBridge(): AndroidBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { LynxedoRadio?: AndroidBridge }).LynxedoRadio
}

/** True when this page runs inside an app build that carries the audio session. */
export function nativeRadioAudioAvailable(): boolean {
  return !!(iosPlugin() || androidBridge())
}

/** The native side said no — today that means a phone call has the microphone.
 *  The message is a short line fit to show the person. */
export class RadioAudioRefused extends Error {}

function parse(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown> } catch { return {} }
}

function messageOf(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  // Capacitor wraps a reject() in an Error whose message is the native string.
  return m || 'Could not start the radio audio session'
}

/**
 * Take over the app's audio session for the channel. Safe to call repeatedly —
 * the native side answers the current state if it is already running.
 *
 * Resolves null on the web (no app, or an app build without the door): the
 * caller carries on the web way. Throws RadioAudioRefused when the native side
 * declined, which is the Dialer's call owning the microphone — a customer
 * always beats "copy that".
 */
export async function startRadioAudio(): Promise<RadioAudioState | null> {
  const ios = iosPlugin()
  if (ios) {
    try { return await ios.start() } catch (e) { throw new RadioAudioRefused(messageOf(e)) }
  }
  const android = androidBridge()
  if (android) {
    const r = parse(android.start())
    if (typeof r.error === 'string' && r.error) throw new RadioAudioRefused(r.error)
    return {
      active: r.active === true,
      bluetooth: r.bluetooth === true,
      output: typeof r.output === 'string' ? r.output : '',
      input: typeof r.input === 'string' ? r.input : '',
    }
  }
  return null
}

/** Hand the session back exactly as it was found. Safe to call twice, and safe
 *  on the web, where there is nothing to hand back. */
export async function stopRadioAudio(): Promise<void> {
  try {
    const ios = iosPlugin()
    if (ios) { await ios.stop(); return }
    androidBridge()?.stop()
  } catch {
    // The channel is closing either way. A tidy-up failure is not the person's problem.
  }
}

// ── Events from the native side ──────────────────────────────────────────────

const androidListeners = new Map<string, Set<Listener>>()
let androidSinkInstalled = false

/** The native side calls this by name. Installed once, on first listener. */
function installAndroidSink() {
  if (androidSinkInstalled || typeof window === 'undefined') return
  androidSinkInstalled = true
  ;(window as unknown as { __lynxedoRadioEvent?: (e: { event: string; data?: Record<string, unknown> }) => void })
    .__lynxedoRadioEvent = (e) => {
      const set = androidListeners.get(e?.event)
      if (!set) return
      // Copy before iterating: a listener that removes itself mid-dispatch would
      // otherwise mutate the set being walked.
      for (const fn of [...set]) {
        try { fn(e.data ?? {}) } catch (err) { console.error('[native-radio-audio] listener threw:', err) }
      }
    }
}

/**
 * Listen for the session being interrupted (a real call, Siri, an alarm — data
 * {active:false} when it begins, {active:true} if the session came back) or the
 * route changing (iOS only; data is a RadioAudioState). Returns the unsubscribe.
 * A no-op on the web.
 */
export function onRadioAudioEvent(event: RadioAudioEvent, fn: Listener): () => void {
  const ios = iosPlugin()
  if (ios) {
    // ⚠⚠ Promise.resolve, never .then on the raw return. The iPhone app hands back a
    // plain { remove } object here, and calling .then on it threw inside the radio's
    // effect — which crashed the whole page into "This page couldn't load" the moment
    // a channel went live on an iPhone (found Oct 15 2026; the Android door doesn't
    // come through here, so it never showed there). A native hiccup must never take
    // the Hub down with it, so a throw is swallowed too.
    let handle: { remove: () => unknown } | null = null
    let removed = false
    try {
      void Promise.resolve(ios.addListener(event, fn)).then(h => {
        if (removed) void h?.remove?.()
        else handle = h ?? null
      }).catch(() => { /* an app build without the plugin — nothing to hear */ })
    } catch { /* ditto */ }
    return () => {
      removed = true
      try { void handle?.remove?.() } catch { /* already gone */ }
    }
  }
  if (androidBridge()) {
    installAndroidSink()
    const set = androidListeners.get(event) ?? new Set<Listener>()
    set.add(fn)
    androidListeners.set(event, set)
    return () => { set.delete(fn) }
  }
  return () => {}
}
