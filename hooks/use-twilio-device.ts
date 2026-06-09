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
  // Incoming call surface
  incomingFrom: string | null
  acceptIncoming: () => void
  rejectIncoming: () => void
  // Outbound. Optional extras travel through the Twilio Voice JS SDK's
  // `device.connect({ params })` as form fields on the TwiML outbound
  // webhook — used by Session 57 click-to-call to stamp the resulting
  // calls row with the originating txt_conversation + txt_contact ids.
  placeCall: (
    number: string,
    extras?: { conversationId?: string | null; contactId?: string | null }
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
  // Transfer (Phase 3) — available when the active call is a conference call.
  // `conferenceActive` gates the in-call Transfer button. `consulting` is true
  // while a warm transfer is mid-consult (customer on hold, target being talked
  // to). `transfer` drives all modes against /conference/transfer.
  conferenceActive: boolean
  consulting: boolean
  transfer: (mode: TransferMode, to?: string) => Promise<{ ok: boolean; error?: string }>
  sendDigit: (digit: string) => void
  hangup: () => void
  // Lifecycle
  ensureRegistered: () => Promise<void>
}

export function useTwilioDevice(options?: { autoRegister?: boolean }): UseTwilioDevice {
  const [state, setState] = useState<DialerState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [identity, setIdentity] = useState<string | null>(null)
  const [incomingFrom, setIncomingFrom] = useState<string | null>(null)
  const [inCallWith, setInCallWith] = useState<string | null>(null)
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null)
  const [muted, setMuted] = useState(false)
  const [held, setHeld] = useState(false)
  const [holdSupported, setHoldSupported] = useState(false)
  // Phase 3 conference state. `conferenceRoom` is set whenever the active call
  // is bridged through a <Conference> (always, for outbound). It gates hold +
  // transfer and is passed to those endpoints. `consulting` tracks a warm
  // transfer mid-flight.
  const [conferenceRoom, setConferenceRoom] = useState<string | null>(null)
  const [consulting, setConsulting] = useState(false)

  const deviceRef = useRef<DeviceType | null>(null)
  const incomingCallRef = useRef<Call | null>(null)
  const activeCallRef = useRef<Call | null>(null)

  // Native (Capacitor) call state. The native Twilio Voice SDK drives the call
  // through CallKit/PushKit — there's no JS Call object — so we mirror its
  // lifecycle into the same state the web path uses via persistent plugin
  // listeners (bound once in ensureRegistered). `nativeActiveFromRef` carries
  // the caller/callee so callConnected can label the in-call screen (the
  // connected event itself only includes the callSid).
  const nativeActiveFromRef = useRef<string | null>(null)
  const nativeHandlesRef = useRef<Array<{ remove: () => void }>>([])
  const nativeBoundRef = useRef(false)

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
            nativeActiveFromRef.current = typeof data?.from === 'string' ? data.from : null
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
            fetchActiveConferenceRoom().then((r) => { if (r) setConferenceRoom(r) })
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
            setConferenceRoom(null)
            setConsulting(false)
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
          // Feature-detect hold so the web Hold button only appears on a
          // hold-capable native build (decouples this web deploy from the app).
          nv.getVersion()
            .then((v) => {
              const caps = Array.isArray(v?.capabilities) ? v.capabilities : []
              if (caps.includes('hold')) setHoldSupported(true)
            })
            .catch(() => { /* old build without capabilities — leave hold hidden */ })
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
        incomingCallRef.current = call
        const from = call.parameters?.From || 'Unknown'
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
          fetchActiveConferenceRoom().then((r) => { if (r) setConferenceRoom(r) })
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

  const acceptIncoming = useCallback(() => {
    incomingCallRef.current?.accept()
  }, [])

  const rejectIncoming = useCallback(() => {
    incomingCallRef.current?.reject()
  }, [])

  const placeCall = useCallback(async (
    number: string,
    extras?: { conversationId?: string | null; contactId?: string | null }
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
  }, [ensureRegistered])

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
      // Track the warm-consult phase so the UI can show Merge / Cancel. A
      // completed (or cold) transfer drops the agent → the disconnect handler
      // resets all call state, so no explicit reset needed there.
      if (mode === 'warm-consult') setConsulting(true)
      else if (mode === 'warm-cancel') setConsulting(false)
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
    incomingFrom,
    acceptIncoming,
    rejectIncoming,
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
    conferenceActive: !!conferenceRoom,
    consulting,
    transfer,
    sendDigit,
    hangup,
    ensureRegistered,
  }
}
