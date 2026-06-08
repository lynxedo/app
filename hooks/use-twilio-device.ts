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
import { nativeVoiceAvailable, getNativeVoice } from '@/lib/native-voice'

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

  const deviceRef = useRef<DeviceType | null>(null)
  const incomingCallRef = useRef<Call | null>(null)
  const activeCallRef = useRef<Call | null>(null)

  const fetchAndApplyToken = useCallback(async (): Promise<string | null> => {
    const res = await fetch('/api/dialer/voice/access-token', { method: 'POST' })
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
    // Native app: outbound calls go through the native Twilio Voice SDK. We don't
    // initialize the in-webview JS Device (WKWebView restricts WebRTC mic access);
    // we just need a token to resolve identity and report readiness. Incoming-call
    // registration lands with CallKit in a later phase.
    if (nativeVoiceAvailable()) {
      setState('connecting')
      setErrorMessage(null)
      try {
        const token = await fetchAndApplyToken()
        setState(token ? 'ready' : 'not-configured')
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
        })
        call.on('disconnect', () => {
          activeCallRef.current = null
          incomingCallRef.current = null
          setInCallWith(null)
          setCallStartedAt(null)
          setIncomingFrom(null)
          setMuted(false)
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
        const params: Record<string, string> = { To: number }
        if (extras?.conversationId) params.txt_conversation_id = extras.conversationId
        if (extras?.contactId) params.txt_contact_id = extras.contactId

        setInCallWith(number)
        const handles: Array<{ remove: () => void }> = []
        const cleanup = () => {
          handles.forEach((h) => { try { h.remove() } catch { /* ignore */ } })
        }
        handles.push(await nv.addListener('callConnected', () => {
          setCallStartedAt(Date.now())
          setState('in-call')
        }))
        handles.push(await nv.addListener('callDisconnected', (data) => {
          const err = typeof data?.error === 'string' ? data.error : ''
          setInCallWith(null)
          setCallStartedAt(null)
          setMuted(false)
          if (err) {
            setErrorMessage(err)
            setState('error')
          } else {
            setState('ready')
          }
          cleanup()
        }))
        await nv.connect({ accessToken: token, params })
      } catch (err) {
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
      const params: Record<string, string> = { To: number }
      if (extras?.conversationId) params.txt_conversation_id = extras.conversationId
      if (extras?.contactId) params.txt_contact_id = extras.contactId
      const call = await device.connect({ params })
      activeCallRef.current = call
      setInCallWith(number)
      call.on('accept', () => {
        setCallStartedAt(Date.now())
        setState('in-call')
      })
      call.on('disconnect', () => {
        activeCallRef.current = null
        setInCallWith(null)
        setCallStartedAt(null)
        setMuted(false)
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
    sendDigit,
    hangup,
    ensureRegistered,
  }
}
