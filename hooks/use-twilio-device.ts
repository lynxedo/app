'use client'

// Hook wrapping the Twilio Voice JS SDK Device class. Handles:
//   - Fetching a Voice Access Token from /api/dialer/voice/access-token
//   - Registering the Device (so this browser can receive inbound calls)
//   - Token refresh ~10s before expiry (via Twilio's tokenWillExpire event)
//   - Outbound call placement
//   - Incoming call handling (accept/reject)
//   - Active call state (mute, send DTMF, disconnect, timer)
//
// The hook keeps everything in module-level state UPDATE — single device per
// browser session — but exposes a state-machine the dialer UI subscribes to.
//
// When Twilio isn't configured (TWILIO_API_KEY_SID etc. empty on the server),
// the access-token endpoint returns { configured: false } and the device
// never initializes. Dialer UI shows a "not configured" pill in that state.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Call, Device as DeviceType } from '@twilio/voice-sdk'
import { nativeVoiceAvailable, getNativeVoice, nativePlatform } from '@/lib/native-voice'
import type { NativeAudioRoute } from '@/lib/native-voice'
import type { DialerLookupMatch } from '@/lib/dialer-lookup'

// Phase 3 transfer modes — mirror the /conference/transfer endpoint.
export type TransferMode = 'cold' | 'warm-consult' | 'warm-complete' | 'warm-cancel'

// Generate a Twilio-safe conference room name client-side (outbound passes it as
// a Voice SDK param so the agent + dialed party land in the same room, and the
// in-call UI knows which room to hold/transfer on).
function genConferenceRoom(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}${Math.random().toString(16).slice(2)}`
  return `conf_${uuid.replace(/[^a-zA-Z0-9]/g, '')}`
}

// Look up the user's active conference room. Used on INBOUND connect — inbound
// rooms are generated server-side, so the agent's dialer has to ask for its
// room to light up the in-call Transfer / Hold controls. Returns null if the
// active call isn't a conference (e.g. legacy ring-group path).
async function fetchActiveConferenceRoom(): Promise<string | null> {
  try {
    const res = await fetch('/api/dialer/voice/conference/active')
    if (!res.ok) return null
    const body = (await res.json()) as { room?: string | null }
    return typeof body?.room === 'string' ? body.room : null
  } catch {
    return null
  }
}

// Resolve the room with a few short retries. The server stamps conference_name
// on the calls row at connect, but a missed/slow status callback (or a re-attach
// firing the instant the call connects) can briefly return null — and a null
// room leaves Hold / Transfer / Record dark. Retrying for a couple seconds
// closes that gap. Returns null only if every attempt comes back empty.
async function fetchActiveConferenceRoomResilient(attempts = 4): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const room = await fetchActiveConferenceRoom()
    if (room) return room
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800))
  }
  return null
}

// ── Web audio device selection (mic + speaker picker) ──────────────────────
// Persisted per browser in localStorage so a user's headset choice sticks
// across sessions. Native builds don't use this — they have the earpiece/
// speaker route picker (audioRoute*) instead.
const AUDIO_INPUT_KEY = 'dialer.audioInputId'
const AUDIO_OUTPUT_KEY = 'dialer.audioOutputId'
const AUDIO_HEADSET_MODE_KEY = 'dialer.headsetMode'

function fallbackDeviceLabel(kind: 'mic' | 'speaker', deviceId: string, index: number): string {
  if (deviceId === 'default') return 'System default'
  if (deviceId === 'communications') return 'Communications device'
  return kind === 'mic' ? `Microphone ${index}` : `Speaker ${index}`
}

function buildAudioDeviceLists(list: MediaDeviceInfo[]): {
  inputs: { deviceId: string; label: string }[]
  outputs: { deviceId: string; label: string }[]
} {
  const inputs: { deviceId: string; label: string }[] = []
  const outputs: { deviceId: string; label: string }[] = []
  let ci = 1
  let co = 1
  for (const d of list) {
    if (!d.deviceId) continue
    if (d.kind === 'audioinput') {
      inputs.push({ deviceId: d.deviceId, label: d.label || fallbackDeviceLabel('mic', d.deviceId, ci++) })
    } else if (d.kind === 'audiooutput') {
      outputs.push({ deviceId: d.deviceId, label: d.label || fallbackDeviceLabel('speaker', d.deviceId, co++) })
    }
  }
  return { inputs, outputs }
}

// Headset mode defaults ON for desktop (browser + Electron app), where agents
// are on headsets, and OFF for mobile browsers. (The native mobile app doesn't
// use this web path at all.) An explicit saved choice always wins.
function isDesktopEnvironment(): boolean {
  if (typeof navigator === 'undefined') return false
  return !/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
}

export type DialerState =
  | 'idle'                  // no token yet
  | 'not-configured'        // Twilio creds empty server-side
  | 'connecting'            // fetching token / registering device
  | 'ready'                 // registered, can place + receive calls
  | 'incoming'              // call ringing
  | 'placing'               // outbound call dialing
  | 'in-call'               // bridged
  | 'ended'                 // brief transition between in-call → ready
  | 'error'                 // setup or call error

export type UseTwilioDevice = {
  state: DialerState
  errorMessage: string | null
  identity: string | null
  // Screen-pop (Session 4). The matched customer identity for the current call's
  // far-end number (inbound caller or outbound dialed party). Looked up once and
  // shared so the bar, PiP, incoming popup, and notification all show the same
  // identity. null = unknown number or no match yet.
  contactMatch: DialerLookupMatch | null
  // Incoming call surface
  incomingFrom: string | null
  acceptIncoming: () => void
  rejectIncoming: () => void
  // Call waiting (web/desktop): a second inbound call arriving while already on
  // one. Surfaced as a SILENT banner (no ringtone). `waitingContactMatch` is the
  // screen-pop for that caller; `dismissWaiting` rejects it. null = no 2nd call.
  waitingFrom: string | null
  waitingContactMatch: DialerLookupMatch | null
  dismissWaiting: () => void
  // Outbound. Optional extras travel through the Twilio Voice JS SDK's
  // `device.connect({ params })` as form fields on the TwiML outbound
  // webhook — used by Session 57 click-to-call to stamp the resulting
  // calls row with the originating txt_conversation + txt_contact ids.
  placeCall: (
    number: string,
    extras?: { conversationId?: string | null; contactId?: string | null; callerId?: string | null }
  ) => Promise<void>
  // Active call surface
  inCallWith: string | null
  callStartedAt: number | null
  muted: boolean
  toggleMute: () => void
  // Hold. On a Phase-3 conference call (the default once the call is bridged
  // through a <Conference>) this is real server-side hold-with-music and works
  // on web, desktop AND native. The legacy native-only client-side hold (silent)
  // is the fallback when there's no conference room. `holdSupported` is true on
  // any conference call, or on a hold-capable native build.
  held: boolean
  toggleHold: () => void
  holdSupported: boolean
  // Audio output route (native app only). `audioRouteSupported` gates the in-call
  // picker (true only on a route-capable native build). `audioRoutesAvailable`
  // lists the routes to offer (Bluetooth only when a device is connected).
  audioRoute: NativeAudioRoute
  audioRouteSupported: boolean
  audioRoutesAvailable: NativeAudioRoute[]
  setAudioRoute: (route: NativeAudioRoute) => void
  // Transfer (Phase 3) — available when the active call is a conference call.
  // `conferenceActive` gates the in-call Transfer button. `consulting` is true
  // while a warm transfer is mid-consult (customer on hold, target being talked
  // to). `transfer` drives all modes against /conference/transfer.
  conferenceActive: boolean
  consulting: boolean
  transfer: (mode: TransferMode, to?: string) => Promise<{ ok: boolean; error?: string }>
  sendDigit: (digit: string) => void
  hangup: () => void
  // Web audio device selection (mic + speaker). Empty/false on native, which
  // uses the earpiece/speaker route picker (audioRoute*) above instead.
  // `outputSelectionSupported` is false on Safari/Firefox (no setSinkId) — the
  // speaker picker hides there; the mic picker still works everywhere.
  audioDeviceSupported: boolean
  outputSelectionSupported: boolean
  audioInputs: { deviceId: string; label: string }[]
  audioOutputs: { deviceId: string; label: string }[]
  selectedInputId: string | null
  selectedOutputId: string | null
  setAudioInput: (deviceId: string) => void
  setAudioOutput: (deviceId: string) => void
  testAudioOutput: () => void
  // "Headset mode" — reduce browser mic processing (echo-cancel + noise-
  // suppression) for fuller audio. Headset-only; off by default.
  headsetMode: boolean
  setHeadsetMode: (on: boolean) => void
  // Called when the picker opens — primes mic permission so device labels show.
  ensureAudioDevices: () => void
  // Lifecycle
  ensureRegistered: () => Promise<void>
}

export function useTwilioDevice(options?: { autoRegister?: boolean }): UseTwilioDevice {
  const [state, setState] = useState<DialerState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [identity, setIdentity] = useState<string | null>(null)
  const [incomingFrom, setIncomingFrom] = useState<string | null>(null)
  const [inCallWith, setInCallWith] = useState<string | null>(null)
  const [contactMatch, setContactMatch] = useState<DialerLookupMatch | null>(null)
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null)
  const [muted, setMuted] = useState(false)
  const [held, setHeld] = useState(false)
  const [holdSupported, setHoldSupported] = useState(false)
  // Audio output route (native only). Default earpiece; the picker is gated on
  // the native build reporting the 'audio-route' capability.
  const [audioRoute, setAudioRouteState] = useState<NativeAudioRoute>('earpiece')
  const [audioRouteSupported, setAudioRouteSupported] = useState(false)
  const [audioRoutesAvailable, setAudioRoutesAvailable] = useState<NativeAudioRoute[]>(['earpiece', 'speaker'])
  // Phase 3 conference state. `conferenceRoom` is set whenever the active call
  // is bridged through a <Conference> (always, for outbound). It gates hold +
  // transfer and is passed to those endpoints. `consulting` tracks a warm
  // transfer mid-flight.
  const [conferenceRoom, setConferenceRoom] = useState<string | null>(null)
  const [consulting, setConsulting] = useState(false)

  // Web audio device selection (mic + speaker picker). Native uses audioRoute*.
  const [audioDeviceSupported, setAudioDeviceSupported] = useState(false)
  const [outputSelectionSupported, setOutputSelectionSupported] = useState(false)
  const [audioInputs, setAudioInputs] = useState<{ deviceId: string; label: string }[]>([])
  const [audioOutputs, setAudioOutputs] = useState<{ deviceId: string; label: string }[]>([])
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null)
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null)
  // Ref mirror of the chosen mic so placeCall / acceptIncoming can read it
  // without a stale closure. 'default'/null both mean "let the browser pick".
  const selectedInputIdRef = useRef<string | null>(null)
  // "Headset mode" — drop the browser's echo-cancellation + noise-suppression
  // for fuller, more natural (and usually louder) audio. Safe ONLY on a headset
  // (no speaker→mic loop); off by default so speakerphone users keep echo
  // protection. Ref mirror for applyAudioForCall.
  const [headsetMode, setHeadsetModeState] = useState(false)
  const headsetModeRef = useRef(false)

  const deviceRef = useRef<DeviceType | null>(null)
  const incomingCallRef = useRef<Call | null>(null)
  const activeCallRef = useRef<Call | null>(null)
  // Call waiting (web/desktop): a SECOND inbound call that arrives while already
  // on a call. Presented as a SILENT on-screen notice (no ringtone, and the main
  // `state` is left on 'in-call' so the active-call UI isn't disturbed).
  const waitingCallRef = useRef<Call | null>(null)
  const [waitingFrom, setWaitingFrom] = useState<string | null>(null)
  const [waitingContactMatch, setWaitingContactMatch] = useState<DialerLookupMatch | null>(null)

  // Native (Capacitor) call state. The native Twilio Voice SDK drives the call
  // through CallKit/PushKit — there's no JS Call object — so we mirror its
  // lifecycle into the same state the web path uses via persistent plugin
  // listeners (bound once in ensureRegistered). `nativeActiveFromRef` carries
  // the caller/callee so callConnected can label the in-call screen (the
  // connected event itself only includes the callSid).
  const nativeActiveFromRef = useRef<string | null>(null)
  const nativeHandlesRef = useRef<Array<{ remove: () => void }>>([])
  const nativeBoundRef = useRef(false)
  // iOS-interim recovery (see recoverActiveCallFromServer): stateRef avoids a
  // stale closure when deciding whether to adopt; adoptedRef marks a call WE
  // adopted from the server (so reconcile only resets those, never a real
  // web/native-event-tracked call).
  const stateRef = useRef<DialerState>('idle')
  const adoptedRef = useRef(false)

  const fetchAndApplyToken = useCallback(async (): Promise<string | null> => {
    // Native clients send their platform so the token carries the matching push
    // credential SID (required for incoming VoIP push). Browser sends no body.
    const platform = nativePlatform()
    const res = await fetch('/api/dialer/voice/access-token', {
      method: 'POST',
      ...(platform
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform }) }
        : {}),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `token_fetch_failed_${res.status}`)
    }
    const body = (await res.json()) as
      | { configured: false; error?: string }
      | { configured: true; token: string; identity: string; ttlSeconds: number; expiresAt: number }
    if (!body.configured) return null
    setIdentity(body.identity)
    return body.token
  }, [])

  // Keep a ref copy of `state` for async callbacks that must read the current
  // value without re-subscribing (recoverActiveCallFromServer).
  useEffect(() => { stateRef.current = state }, [state])

  // iOS-only interim: the iOS native plugin lacks getActiveCall, so when a call
  // is answered on CallKit the webview can miss the live `callConnected` event
  // and never show the in-call screen (End/Hold/Transfer). Until a native build
  // ships getActiveCall, recover from the SERVER instead: ask whether this user
  // has a live, ANSWERED conference and adopt it into the in-call UI. Returns
  // true if it adopted (or is already in a call), false otherwise.
  //
  // Strictly scoped so it can never disturb working paths:
  //   - native only, and only on builds WITHOUT native getActiveCall (i.e. iOS;
  //     Android's native path already handles this);
  //   - only ADOPTS when the web isn't already tracking a call (idle/ready/…);
  //   - only adopts ANSWERED calls (never one still ringing through a group);
  //   - only RESETS calls it adopted itself (adoptedRef), never a real one.
  const recoverActiveCallFromServer = useCallback(async (): Promise<boolean> => {
    const nv = getNativeVoice()
    if (!nv || typeof nv.getActiveCall === 'function') return false
    const cur = stateRef.current
    const busy = cur === 'incoming' || cur === 'placing' || cur === 'in-call'
    try {
      const res = await fetch('/api/dialer/voice/conference/active')
      if (!res.ok) return cur === 'in-call'
      const body = (await res.json().catch(() => null)) as
        | { room?: string | null; answered?: boolean; from?: string | null }
        | null
      const room = typeof body?.room === 'string' ? body.room : null
      const answered = !!body?.answered
      if (room && answered) {
        if (busy) return true // already handling this (or another) call
        adoptedRef.current = true
        const from = typeof body?.from === 'string' && body.from ? body.from : null
        nativeActiveFromRef.current = from
        if (from) setInCallWith(from)
        setIncomingFrom(null)
        setCallStartedAt(Date.now())
        setConferenceRoom(room)
        setState('in-call')
        getNativeVoice()?.getAudioRoutes()
          .then((s) => {
            if (s?.current) setAudioRouteState(s.current)
            if (Array.isArray(s?.routes)) setAudioRoutesAvailable(s.routes)
          })
          .catch(() => { /* non-route-capable build — picker stays hidden */ })
        return true
      }
      // No live answered call. If WE adopted one and it's since ended (the native
      // callDisconnected was missed too), reconcile back to ready.
      if (adoptedRef.current && cur === 'in-call') {
        adoptedRef.current = false
        setInCallWith(null)
        setCallStartedAt(null)
        setConferenceRoom(null)
        setHeld(false)
        setState('ready')
      }
      return false
    } catch {
      return cur === 'in-call'
    }
  }, [])

  // Recover the in-call screen on app FOREGROUND. Answering on CallKit brings the
  // app forward WITHOUT remounting the dialer, so the mount-time recovery won't
  // re-run — this catches that case for both build types:
  //   - native getActiveCall present (Android, and iOS once rebuilt) → ask the
  //     plugin directly and re-adopt the live call;
  //   - absent (current iOS build) → fall back to the server recovery (interim).
  useEffect(() => {
    if (!nativeVoiceAvailable()) return
    const onForeground = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      const nv = getNativeVoice()
      if (!nv) return
      if (typeof nv.getActiveCall === 'function') {
        const cur = stateRef.current
        if (cur === 'in-call' || cur === 'incoming' || cur === 'placing') return
        try {
          const active = await nv.getActiveCall()
          if (active?.active) {
            const from = typeof active.from === 'string' && active.from ? active.from : null
            nativeActiveFromRef.current = from
            if (from) setInCallWith(from)
            setCallStartedAt(
              typeof active.startedAtMs === 'number' && active.startedAtMs > 0 ? active.startedAtMs : Date.now()
            )
            setMuted(!!active.muted)
            setHeld(!!active.onHold)
            setIncomingFrom(null)
            setState('in-call')
            fetchActiveConferenceRoomResilient().then((r) => { if (r) setConferenceRoom(r) })
          }
        } catch { /* ignore */ }
        return
      }
      void recoverActiveCallFromServer()
    }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('focus', onForeground)
    return () => {
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('focus', onForeground)
    }
  }, [recoverActiveCallFromServer])

  const ensureRegistered = useCallback(async () => {
    // Native app: outbound calls go through the native Twilio Voice SDK, and we
    // register the device with Twilio for incoming calls (PushKit + CallKit handle
    // the native ring). We don't initialize the in-webview JS Device — WKWebView
    // restricts WebRTC mic access, which is the whole reason for the native path.
    if (nativeVoiceAvailable()) {
      setState('connecting')
      setErrorMessage(null)
      try {
        const nv = getNativeVoice()
        // Bind the native call-lifecycle listeners ONCE. These are the only way
        // the JS/Hub UI learns a native call is live: incoming calls arrive via
        // PushKit→CallKit and outbound goes through the native Twilio Voice SDK,
        // so without these the dialer would sit on "Ready" while the user is
        // mid-call (the call lives entirely in the native layer). Single source
        // of truth for both directions — placeCall no longer binds its own.
        if (nv && !nativeBoundRef.current) {
          nativeBoundRef.current = true
          const handles = nativeHandlesRef.current
          // Incoming VoIP push. CallKit owns the native ring UX, so we do NOT
          // raise the web IncomingCall overlay here (it would be a dead,
          // duplicate ring screen on top of CallKit). We only stash the caller
          // so callConnected can label the in-call screen once answered.
          handles.push(await nv.addListener('incomingCall', (data) => {
            const from = typeof data?.from === 'string' ? data.from : null
            nativeActiveFromRef.current = from
            // Android has no system call UI (iOS has CallKit), so raise the
            // in-app incoming overlay here when the app is open — otherwise the
            // ONLY way to answer is the notification's Answer button, even with
            // the dialer on screen. iOS deliberately stays notification/CallKit-
            // driven to avoid a duplicate dead overlay over CallKit.
            if (nativePlatform() === 'android') {
              setIncomingFrom(from || 'Unknown')
              setState('incoming')
            }
          }))
          // Connected — inbound (answered in CallKit) OR outbound. Drives the
          // Hub Dialer into the in-call state so it reflects the live call.
          handles.push(await nv.addListener('callConnected', () => {
            if (nativeActiveFromRef.current) setInCallWith(nativeActiveFromRef.current)
            setCallStartedAt(Date.now())
            setIncomingFrom(null)
            setState('in-call')
            // Inbound: discover the server-generated conference room so the
            // in-call Transfer / Hold controls light up. (Outbound already set it.)
            fetchActiveConferenceRoomResilient().then((r) => { if (r) setConferenceRoom(r) })
            // Initialize the audio-route picker with the call's starting route +
            // which routes are available (e.g. Bluetooth if a headset is paired).
            getNativeVoice()?.getAudioRoutes()
              .then((s) => {
                if (s?.current) setAudioRouteState(s.current)
                if (Array.isArray(s?.routes)) setAudioRoutesAvailable(s.routes)
              })
              .catch(() => { /* non-route-capable build — picker stays hidden */ })
          }))
          // Disconnected — local hangup (web button or CallKit), remote hangup,
          // or a declined/cancelled incoming call. Resets back to ready.
          handles.push(await nv.addListener('callDisconnected', (data) => {
            const err = typeof data?.error === 'string' ? data.error : ''
            nativeActiveFromRef.current = null
            setInCallWith(null)
            setCallStartedAt(null)
            setIncomingFrom(null)
            setMuted(false)
            setHeld(false)
            setAudioRouteState('earpiece')
            setAudioRoutesAvailable(['earpiece', 'speaker'])
            setConferenceRoom(null)
            setConsulting(false)
            adoptedRef.current = false
            if (err) {
              setErrorMessage(err)
              setState('error')
            } else {
              setState('ready')
            }
          }))
          // Hold state — kept in sync whether hold was toggled from the web
          // button or the native CallKit / lock-screen / CarPlay Hold control.
          handles.push(await nv.addListener('callHold', (data) => {
            setHeld(!!data?.held)
          }))
          // Audio route — kept in sync whether the route was changed from the
          // web picker, the native CallKit UI route button, or a Bluetooth
          // device connecting / disconnecting mid-call.
          handles.push(await nv.addListener('audioRouteChanged', (data) => {
            if (typeof data?.current === 'string') setAudioRouteState(data.current as NativeAudioRoute)
            if (Array.isArray(data?.routes)) setAudioRoutesAvailable(data.routes as NativeAudioRoute[])
          }))
          // Feature-detect capabilities so the web Hold button + audio-route
          // picker only appear on a build that supports them (decouples this web
          // deploy from the app build).
          nv.getVersion()
            .then((v) => {
              const caps = Array.isArray(v?.capabilities) ? v.capabilities : []
              if (caps.includes('hold')) setHoldSupported(true)
              if (caps.includes('audio-route')) setAudioRouteSupported(true)
            })
            .catch(() => { /* old build without capabilities — leave controls hidden */ })
        }
        const token = await fetchAndApplyToken()
        if (!token) {
          setState('not-configured')
          return
        }
        // Register for incoming calls (native VoIP push). Best-effort — outbound
        // still works even if registration fails.
        try {
          await nv?.register({ accessToken: token })
        } catch { /* surfaced via the native registrationFailed event */ }
        // RE-ATTACH to a call that's already live. The native call object lives
        // in the app process, not the webview — so answering from the lock-screen
        // notification (which relaunches/navigates the webview to /hub/dialer)
        // can blow away the page that was listening for callConnected, leaving the
        // remounted dialer sitting on "Ready" mid-call. Mute/hangup still work
        // (they hit the persistent native call), but conferenceRoom is null so
        // Hold/Transfer/Record stay dark. Ask the native side if a call is live
        // and rebuild the in-call state — including re-fetching the conference
        // room, which is the whole fix. Best-effort: older builds (and iOS until
        // rebuilt) lack getActiveCall, so this no-ops there.
        try {
          const active = await nv?.getActiveCall?.()
          // App opened while a call is still RINGING (e.g. tapped the incoming
          // notification on Android) — raise the in-app overlay so it can be
          // answered in-app, not only from the notification.
          if (active?.ringing && nativePlatform() === 'android') {
            const from = typeof active.from === 'string' && active.from ? active.from : 'Unknown'
            nativeActiveFromRef.current = from
            setIncomingFrom(from)
            setState('incoming')
            return
          }
          if (active?.active) {
            const from = typeof active.from === 'string' && active.from ? active.from : null
            nativeActiveFromRef.current = from
            if (from) setInCallWith(from)
            setCallStartedAt(
              typeof active.startedAtMs === 'number' && active.startedAtMs > 0
                ? active.startedAtMs
                : Date.now()
            )
            setMuted(!!active.muted)
            setHeld(!!active.onHold)
            setIncomingFrom(null)
            setState('in-call')
            fetchActiveConferenceRoomResilient().then((r) => { if (r) setConferenceRoom(r) })
            getNativeVoice()?.getAudioRoutes()
              .then((s) => {
                if (s?.current) setAudioRouteState(s.current)
                if (Array.isArray(s?.routes)) setAudioRoutesAvailable(s.routes)
              })
              .catch(() => { /* non-route-capable build — picker stays hidden */ })
            return
          }
        } catch { /* no getActiveCall on this build — fall through to ready */ }
        // iOS interim: no native getActiveCall here, so recover a live answered
        // call from the server instead. If it adopts one, don't fall to 'ready'.
        if (typeof nv?.getActiveCall !== 'function') {
          const adopted = await recoverActiveCallFromServer()
          if (adopted) return
        }
        setState('ready')
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'device_init_failed')
        setState('error')
      }
      return
    }
    if (deviceRef.current) return
    setState('connecting')
    setErrorMessage(null)
    try {
      const token = await fetchAndApplyToken()
      if (token === null) {
        setState('not-configured')
        return
      }
      // Dynamic import: keeps the SDK out of the SSR bundle and only loads
      // it when the dialer page mounts.
      const { Device } = await import('@twilio/voice-sdk')
      const device = new Device(token, {
        logLevel: 1, // 0=trace, 1=debug, 5=silent
        // Edge selection — Twilio recommends letting the SDK auto-pick
        // unless the deployment is region-locked.
        edge: 'roaming',
        // Prefer Opus (wideband) over PCMU. The SDK default is [PCMU, Opus],
        // i.e. narrowband G.711 first — which makes the web/desktop softphone
        // sound thin, quiet and "hollow/speakerphone" vs the native app (the
        // native Twilio Voice SDK already defaults to Opus and sounds clear).
        // Applies to both inbound-accepted and outbound legs. Opus also uses
        // LESS bandwidth than PCMU and handles packet loss far better.
        codecPreferences: ['opus', 'pcmu'] as Call.Codec[],
        // Nudge Opus toward crisper voice on Chrome/Edge (Chromium-only SDP
        // tweak; ignored elsewhere). 32 kbps is ample for speech and well
        // within the SDK's 6k–510k bounds.
        maxAverageBitrate: 32000,
        // Call waiting: raise `incoming` even when already on a call. The SDK
        // default is false (a 2nd call is silently rejected as busy). We accept
        // it so the user gets a SILENT on-screen notice of the second caller —
        // the ringtone is muted while busy (see the `incoming` handler below).
        // Web/desktop only; native takes its own branch above and is unaffected.
        allowIncomingWhileBusy: true,
      })

      device.on('registered', () => setState('ready'))
      device.on('unregistered', () => setState('idle'))
      device.on('error', (e: Error) => {
        setErrorMessage(e.message)
        setState('error')
      })
      device.on('tokenWillExpire', async () => {
        try {
          const newToken = await fetchAndApplyToken()
          if (newToken) device.updateToken(newToken)
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : 'token_refresh_failed')
        }
      })
      device.on('incoming', (call: Call) => {
        const from = call.parameters?.From || 'Unknown'
        // ── Call waiting ──────────────────────────────────────────────────────
        // Already on a call → present the second call as a SILENT notice: mute
        // the ringtone and DON'T touch `state` (setting it to 'incoming' would
        // blow away the active-call UI). The user sees a "call waiting" banner
        // and can finish the current call or dismiss it.
        if (activeCallRef.current) {
          device.audio?.incoming(false) // silence ONLY the incoming ringtone
          waitingCallRef.current = call
          setWaitingFrom(from)
          const clearWaiting = () => {
            if (waitingCallRef.current === call) {
              waitingCallRef.current = null
              setWaitingFrom(null)
            }
            // Restore the ring for the NEXT call once we're no longer busy.
            device.audio?.incoming(!activeCallRef.current)
          }
          call.on('accept', clearWaiting)
          call.on('disconnect', clearWaiting)
          call.on('cancel', clearWaiting)
          call.on('reject', clearWaiting)
          return
        }
        // Not busy → normal audible incoming. Ensure the ring is on (self-heals
        // if a prior waiting call left it muted).
        device.audio?.incoming(true)
        incomingCallRef.current = call
        setIncomingFrom(from)
        setState('incoming')
        call.on('accept', () => {
          activeCallRef.current = call
          incomingCallRef.current = null
          setInCallWith(from)
          setCallStartedAt(Date.now())
          setIncomingFrom(null)
          setState('in-call')
          // Inbound: discover the server-generated conference room so the
          // in-call Transfer / Hold controls light up.
          fetchActiveConferenceRoomResilient().then((r) => { if (r) setConferenceRoom(r) })
        })
        call.on('disconnect', () => {
          activeCallRef.current = null
          incomingCallRef.current = null
          setInCallWith(null)
          setCallStartedAt(null)
          setIncomingFrom(null)
          setMuted(false)
          setHeld(false)
          setConferenceRoom(null)
          setConsulting(false)
          deviceRef.current?.audio?.unsetInputDevice().catch(() => {})
          setState('ready')
        })
        call.on('cancel', () => {
          incomingCallRef.current = null
          setIncomingFrom(null)
          setState('ready')
        })
        call.on('reject', () => {
          incomingCallRef.current = null
          setIncomingFrom(null)
          setState('ready')
        })
      })

      // ── Web audio device selection ───────────────────────────────────────
      // Enable the picker + restore the saved selection for display. The saved
      // mic/speaker are actually applied per-call (applyAudioForCall) so we
      // never hold the mic open while idle. Best-effort — never block register.
      try {
        const audio = device.audio
        if (audio && typeof navigator !== 'undefined' && navigator.mediaDevices) {
          setAudioDeviceSupported(true)
          setOutputSelectionSupported(!!audio.isOutputSelectionSupported)
          let savedIn: string | null = null
          let savedOut: string | null = null
          try { savedIn = localStorage.getItem(AUDIO_INPUT_KEY) } catch { /* ignore */ }
          try { savedOut = localStorage.getItem(AUDIO_OUTPUT_KEY) } catch { /* ignore */ }
          selectedInputIdRef.current = savedIn
          setSelectedInputId(savedIn ?? 'default')
          setSelectedOutputId(savedOut ?? 'default')
          let savedHm: string | null = null
          try { savedHm = localStorage.getItem(AUDIO_HEADSET_MODE_KEY) } catch { /* ignore */ }
          // Default ON for desktop (headset assumed); respect an explicit choice.
          const hmOn = savedHm === null ? isDesktopEnvironment() : savedHm === '1'
          headsetModeRef.current = hmOn
          setHeadsetModeState(hmOn)
        }
      } catch { /* audio helper unavailable — picker stays hidden */ }

      await device.register()
      deviceRef.current = device
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'device_init_failed'
      setErrorMessage(msg)
      setState('error')
    }
  }, [fetchAndApplyToken])

  // Auto-register on mount when requested
  useEffect(() => {
    if (options?.autoRegister) {
      ensureRegistered()
    }
    return () => {
      const d = deviceRef.current
      if (d) {
        try { d.destroy() } catch { /* ignore */ }
        deviceRef.current = null
      }
      nativeHandlesRef.current.forEach((h) => { try { h.remove() } catch { /* ignore */ } })
      nativeHandlesRef.current = []
      nativeBoundRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.autoRegister])

  // Backstop: while a native call is up but we still have no conference room,
  // poll for it. This is the robust path that does NOT depend on catching the
  // one-shot callConnected event — which on Android can be missed entirely
  // (answering from the lock-screen notification reloads the webview) or fire
  // before the server has stamped the room. Inbound rooms are created
  // server-side, so this is how the in-call screen lights up Hold / Transfer /
  // Record. Stops as soon as the room resolves, the call ends, or ~18s passes.
  useEffect(() => {
    if (!nativeVoiceAvailable()) return
    if ((state !== 'in-call' && state !== 'placing') || conferenceRoom) return
    let cancelled = false
    let tries = 0
    const id = setInterval(async () => {
      tries += 1
      const r = await fetchActiveConferenceRoom()
      if (cancelled) return
      if (r) {
        setConferenceRoom(r)
        clearInterval(id)
      } else if (tries >= 12) {
        clearInterval(id)
      }
    }, 1500)
    return () => { cancelled = true; clearInterval(id) }
  }, [state, conferenceRoom])

  // Screen-pop lookup (Session 4). Keyed on the current far-end number, which is
  // `incomingFrom` while ringing and `inCallWith` once placing/connected — so a
  // single effect covers every path (web + native, inbound + outbound, and the
  // native re-attach). Looks up the customer identity once per distinct number
  // and clears it when the call ends. A failed/empty lookup just leaves the raw
  // number — never blocks the call UI.
  const remoteNumber = incomingFrom || inCallWith
  const lookedUpRef = useRef<string | null>(null)
  useEffect(() => {
    if (!remoteNumber) {
      setContactMatch(null)
      lookedUpRef.current = null
      return
    }
    if (lookedUpRef.current === remoteNumber) return
    lookedUpRef.current = remoteNumber
    setContactMatch(null)
    // Skip obviously non-lookupable numbers (extensions, "Unknown", anonymous).
    const digits = remoteNumber.replace(/\D/g, '')
    if (digits.length < 10) return
    let cancelled = false
    fetch(`/api/dialer/lookup?phone=${encodeURIComponent(remoteNumber)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.match) setContactMatch(d.match) })
      .catch(() => { /* degrade to raw number */ })
    return () => { cancelled = true }
  }, [remoteNumber])

  // Screen-pop lookup for the SILENT call-waiting banner's caller — independent
  // of `contactMatch`, which stays pinned to the active call the user is on.
  const waitingLookedUpRef = useRef<string | null>(null)
  useEffect(() => {
    if (!waitingFrom) {
      setWaitingContactMatch(null)
      waitingLookedUpRef.current = null
      return
    }
    if (waitingLookedUpRef.current === waitingFrom) return
    waitingLookedUpRef.current = waitingFrom
    setWaitingContactMatch(null)
    const digits = waitingFrom.replace(/\D/g, '')
    if (digits.length < 10) return
    let cancelled = false
    fetch(`/api/dialer/lookup?phone=${encodeURIComponent(waitingFrom)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.match) setWaitingContactMatch(d.match) })
      .catch(() => { /* degrade to raw number */ })
    return () => { cancelled = true }
  }, [waitingFrom])

  // ── Web audio device selection (mic + speaker picker) ────────────────────
  // Lists come straight from navigator.enumerateDevices (independent of SDK
  // refresh timing); selection is applied through the Twilio AudioHelper.
  // Native is unaffected — audioDeviceSupported stays false there.
  const refreshAudioDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
    try {
      const { inputs, outputs } = buildAudioDeviceLists(await navigator.mediaDevices.enumerateDevices())
      setAudioInputs(inputs)
      setAudioOutputs(outputs)
    } catch { /* ignore */ }
  }, [])

  const ensureAudioDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
    try {
      let list = await navigator.mediaDevices.enumerateDevices()
      // Labels are blank until the origin has been granted mic permission once
      // — prime it so the picker shows real device names, not "Microphone 1".
      const hasLabels = list.some((d) => (d.kind === 'audioinput' || d.kind === 'audiooutput') && !!d.label)
      if (!hasLabels) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
        if (stream) stream.getTracks().forEach((t) => t.stop())
        list = await navigator.mediaDevices.enumerateDevices()
      }
      const { inputs, outputs } = buildAudioDeviceLists(list)
      setAudioInputs(inputs)
      setAudioOutputs(outputs)
    } catch { /* ignore */ }
  }, [])

  // Apply the user's saved mic + speaker to the SDK right before a call. Doing
  // it per-call (not at registration) means we never hold the mic open — and
  // show the browser "recording" dot — while idle. 'default'/null → let the
  // browser pick, matching the original behavior.
  const applyAudioForCall = useCallback(async () => {
    const audio = deviceRef.current?.audio
    if (!audio) return
    const inId = selectedInputIdRef.current
    if (inId && inId !== 'default') {
      try { await audio.setInputDevice(inId) } catch { /* fall back to default mic */ }
    }
    if (audio.isOutputSelectionSupported) {
      let outId: string | null = null
      try { outId = localStorage.getItem(AUDIO_OUTPUT_KEY) } catch { /* ignore */ }
      // Re-point call audio at the saved speaker ONLY if it still exists. If the
      // saved device is gone (headset unplugged, Bluetooth dropped, or a stale
      // OS device id) — or nothing is saved — fall back to the system default
      // EXPLICITLY. Skipping the set instead (the old behavior) left the SDK
      // pinned to the missing device, so call audio played to nothing and the
      // agent heard silence until a full reload. Resetting to default here makes
      // it self-heal on the very next call.
      const outTarget =
        outId && outId !== 'default' && audio.availableOutputDevices.has(outId) ? outId : 'default'
      try { await audio.speakerDevices.set(outTarget) } catch { /* ignore */ }
    }
    // Headset mode: drop echo-cancellation (the main cause of the "hollow"
    // sound) for fuller audio, but KEEP noise-suppression on so office
    // background noise doesn't reach the caller.
    try {
      if (headsetModeRef.current) {
        await audio.setAudioConstraints({ echoCancellation: false })
      } else {
        await audio.unsetAudioConstraints()
      }
    } catch { /* constraints unsupported — ignore */ }
  }, [])

  const setAudioInput = useCallback((deviceId: string) => {
    selectedInputIdRef.current = deviceId
    setSelectedInputId(deviceId)
    try { localStorage.setItem(AUDIO_INPUT_KEY, deviceId) } catch { /* ignore */ }
    // Live-swap the mic if a call is active; otherwise it takes effect on the
    // next call (applyAudioForCall).
    const audio = deviceRef.current?.audio
    if (audio && activeCallRef.current) audio.setInputDevice(deviceId).catch(() => {})
  }, [])

  const setAudioOutput = useCallback((deviceId: string) => {
    setSelectedOutputId(deviceId)
    try { localStorage.setItem(AUDIO_OUTPUT_KEY, deviceId) } catch { /* ignore */ }
    const audio = deviceRef.current?.audio
    if (audio?.isOutputSelectionSupported) audio.speakerDevices.set(deviceId).catch(() => {})
  }, [])

  const testAudioOutput = useCallback(() => {
    deviceRef.current?.audio?.speakerDevices.test().catch(() => {})
  }, [])

  const setHeadsetMode = useCallback((on: boolean) => {
    headsetModeRef.current = on
    setHeadsetModeState(on)
    try { localStorage.setItem(AUDIO_HEADSET_MODE_KEY, on ? '1' : '0') } catch { /* ignore */ }
    // Apply live if a call is active; otherwise it takes effect on the next call.
    const audio = deviceRef.current?.audio
    if (audio && activeCallRef.current) {
      (on
        ? audio.setAudioConstraints({ echoCancellation: false })
        : audio.unsetAudioConstraints()
      ).catch(() => {})
    }
  }, [])

  // Keep the mic/speaker lists fresh as devices are plugged/unplugged (web only).
  useEffect(() => {
    if (!audioDeviceSupported || typeof navigator === 'undefined' || !navigator.mediaDevices) return
    void refreshAudioDevices()
    const onChange = () => { void refreshAudioDevices() }
    navigator.mediaDevices.addEventListener?.('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', onChange)
  }, [audioDeviceSupported, refreshAudioDevices])

  const acceptIncoming = useCallback(() => {
    // Native (Android overlay): answer the pending invite through the plugin —
    // there's no JS Call object. callConnected then drives the in-call screen.
    if (nativeVoiceAvailable()) {
      getNativeVoice()?.acceptCall?.()
      return
    }
    const call = incomingCallRef.current
    if (!call) return
    // Apply the chosen mic + speaker before answering, then accept.
    void applyAudioForCall().finally(() => call.accept())
  }, [applyAudioForCall])

  const rejectIncoming = useCallback(() => {
    if (nativeVoiceAvailable()) {
      getNativeVoice()?.rejectCall?.()
      setIncomingFrom(null)
      setState('ready')
      return
    }
    incomingCallRef.current?.reject()
  }, [])

  // Dismiss the silent "call waiting" notice: reject the second call (it rolls to
  // voicemail / the next person) and clear the banner. Web/desktop only — the
  // waiting surface never populates on native.
  const dismissWaiting = useCallback(() => {
    const call = waitingCallRef.current
    waitingCallRef.current = null
    setWaitingFrom(null)
    try { call?.reject() } catch { /* already gone */ }
    // Ensure the ring is back on for the next call if we're no longer busy.
    deviceRef.current?.audio?.incoming(!activeCallRef.current)
  }, [])

  const placeCall = useCallback(async (
    number: string,
    extras?: { conversationId?: string | null; contactId?: string | null; callerId?: string | null }
  ) => {
    // Native path: drive the call through the native Twilio Voice SDK. Token fetch
    // and the To/extras params are identical to the web path, so the outbound TwiML
    // webhook behaves the same — only the audio transport differs.
    if (nativeVoiceAvailable()) {
      // Make sure the persistent call-lifecycle listeners are bound (they own
      // the in-call → ready transitions for native). ensureRegistered is a
      // no-op for binding once nativeBoundRef is set.
      if (!nativeBoundRef.current) {
        await ensureRegistered()
      }
      const nv = getNativeVoice()
      if (!nv) {
        setErrorMessage('Native voice unavailable')
        setState('error')
        return
      }
      setState('placing')
      setMuted(false)
      try {
        const token = await fetchAndApplyToken()
        if (!token) {
          setState('not-configured')
          return
        }
        const room = genConferenceRoom()
        const params: Record<string, string> = { To: number, room }
        if (extras?.conversationId) params.txt_conversation_id = extras.conversationId
        if (extras?.contactId) params.txt_contact_id = extras.contactId
        if (extras?.callerId) params.caller_id = extras.callerId

        // The persistent callConnected / callDisconnected listeners bound in
        // ensureRegistered drive the rest of the lifecycle.
        nativeActiveFromRef.current = number
        setInCallWith(number)
        setConferenceRoom(room)
        await nv.connect({ accessToken: token, params })
      } catch (err) {
        nativeActiveFromRef.current = null
        setInCallWith(null)
        setErrorMessage(err instanceof Error ? err.message : 'place_call_failed')
        setState('error')
      }
      return
    }
    if (!deviceRef.current) {
      await ensureRegistered()
    }
    const device = deviceRef.current
    if (!device) {
      setErrorMessage('Device not ready')
      setState('error')
      return
    }
    setState('placing')
    setMuted(false)
    try {
      const room = genConferenceRoom()
      const params: Record<string, string> = { To: number, room }
      if (extras?.conversationId) params.txt_conversation_id = extras.conversationId
      if (extras?.contactId) params.txt_contact_id = extras.contactId
      if (extras?.callerId) params.caller_id = extras.callerId
      // Apply the user's chosen mic + speaker (if any) before dialing.
      await applyAudioForCall()
      const call = await device.connect({ params })
      activeCallRef.current = call
      setInCallWith(number)
      setConferenceRoom(room)
      call.on('accept', () => {
        setCallStartedAt(Date.now())
        setState('in-call')
      })
      call.on('disconnect', () => {
        activeCallRef.current = null
        setInCallWith(null)
        setCallStartedAt(null)
        setMuted(false)
        setHeld(false)
        setConferenceRoom(null)
        setConsulting(false)
        deviceRef.current?.audio?.unsetInputDevice().catch(() => {})
        setState('ready')
      })
      call.on('error', (e: Error) => {
        setErrorMessage(e.message)
        setState('error')
      })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'place_call_failed')
      setState('error')
    }
  }, [ensureRegistered, applyAudioForCall])

  const toggleMute = useCallback(() => {
    const next = !muted
    if (nativeVoiceAvailable()) {
      getNativeVoice()?.setMuted({ muted: next })
      setMuted(next)
      return
    }
    const call = activeCallRef.current
    if (!call) return
    call.mute(next)
    setMuted(next)
  }, [muted])

  const toggleHold = useCallback(() => {
    const next = !held
    // Conference call → real server-side hold-with-music. Works on web, desktop,
    // and native (holds the 'customer' participant). Optimistic; revert on error.
    if (conferenceRoom) {
      setHeld(next)
      fetch('/api/dialer/voice/conference/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: conferenceRoom, hold: next }),
      })
        .then((r) => { if (!r.ok) setHeld(!next) })
        .catch(() => setHeld(!next))
      return
    }
    // Legacy native-only client-side hold (silent). The native `callHold` event
    // confirms / corrects the real state.
    if (!nativeVoiceAvailable()) return
    getNativeVoice()?.setOnHold({ onHold: next })
    setHeld(next)
  }, [held, conferenceRoom])

  const setAudioRoute = useCallback((route: NativeAudioRoute) => {
    if (!nativeVoiceAvailable()) return
    // Optimistic; the native `audioRouteChanged` event confirms / corrects the
    // route the session actually settled on.
    setAudioRouteState(route)
    getNativeVoice()?.setAudioRoute({ route }).catch(() => { /* surfaced via audioRouteFailed */ })
  }, [])

  const transfer = useCallback(async (
    mode: TransferMode,
    to?: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!conferenceRoom) return { ok: false, error: 'No conference call' }
    try {
      const res = await fetch('/api/dialer/voice/conference/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: conferenceRoom, mode, to }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return { ok: false, error: body.error || `transfer_failed_${res.status}` }
      // Track the warm-consult phase so the UI can show Merge / Cancel.
      if (mode === 'warm-consult') setConsulting(true)
      else if (mode === 'warm-cancel') setConsulting(false)
      // cold / warm-complete: the server kept our leg bridged + flagged the
      // conference to survive our exit, then asked us to drop ourselves. Hang up
      // our OWN leg via the normal disconnect path so the native CallKit call
      // ends cleanly (a server-side remote kill leaves it lingering in the
      // iPhone's phone UI). The disconnect handler resets all call state.
      if ((mode === 'cold' || mode === 'warm-complete')) {
        if (nativeVoiceAvailable()) getNativeVoice()?.disconnect()
        else activeCallRef.current?.disconnect()
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'transfer_failed' }
    }
  }, [conferenceRoom])

  const sendDigit = useCallback((digit: string) => {
    activeCallRef.current?.sendDigits(digit)
  }, [])

  const hangup = useCallback(() => {
    if (nativeVoiceAvailable()) {
      getNativeVoice()?.disconnect()
      return
    }
    activeCallRef.current?.disconnect()
    incomingCallRef.current?.reject()
  }, [])

  return {
    state,
    errorMessage,
    identity,
    contactMatch,
    incomingFrom,
    acceptIncoming,
    rejectIncoming,
    waitingFrom,
    waitingContactMatch,
    dismissWaiting,
    placeCall,
    inCallWith,
    callStartedAt,
    muted,
    toggleMute,
    held,
    toggleHold,
    // Hold works on any conference call (server-side music) OR a hold-capable
    // native build (legacy client-side).
    holdSupported: holdSupported || !!conferenceRoom,
    audioRoute,
    audioRouteSupported,
    audioRoutesAvailable,
    setAudioRoute,
    conferenceActive: !!conferenceRoom,
    consulting,
    transfer,
    sendDigit,
    hangup,
    audioDeviceSupported,
    outputSelectionSupported,
    audioInputs,
    audioOutputs,
    selectedInputId,
    selectedOutputId,
    setAudioInput,
    setAudioOutput,
    testAudioOutput,
    headsetMode,
    setHeadsetMode,
    ensureAudioDevices,
    ensureRegistered,
  }
}
