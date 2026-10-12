'use client'

// The Radio screen: near-full-screen, thumb-first, usable with a glove on and the
// phone at your hip. Design: Hub/HUB_RADIO_PRD.md.
//
// The channel is server state and stays warm for an hour; this screen is only a
// window onto it. Leaving does NOT close it — but it DOES drop the microphone,
// because Workspace Tabs keep a hidden page mounted with its effects running, and a
// live mic on a tab you switched away from is exactly the kind of thing that makes
// people stop trusting a feature.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeSharedBroadcast } from '@/lib/realtime-shared-channel'
import { RadioCapture, bluetoothWarningFor } from '@/lib/radio/capture'
import { RadioPlayQueue } from '@/lib/radio/playQueue'
import { radioTopic, type RadioStatus } from '@/lib/radio/types'
import { startRadioInviteRing, stopRadioInviteRing } from '@/lib/radio/ring'
import { haptic, keepAwake } from '@/lib/native-device'
import { startRadioAudio, stopRadioAudio, onRadioAudioEvent, RadioAudioRefused, type RadioAudioState } from '@/lib/native-radio-audio'
import { playRadioTone } from '@/lib/hub-chime'
import { MicIcon, SpeakerIcon, RadioIcon } from './RadioIcons'

const AMBER_AT_MS = 45_000

type SessionState = {
  session: { id: string; conversation_id: string; status: RadioStatus }
  expiresAt: string | null
  me: { id: string; name: string; isInitiator: boolean }
  other: { id: string; name: string }
}


export default function RadioScreen({ sessionId, initial }: { sessionId: string; initial: SessionState }) {
  const router = useRouter()
  const [state, setState] = useState<SessionState>(initial)
  const [talking, setTalking] = useState(false)          // me
  const [theirTurn, setTheirTurn] = useState(false)      // them
  const [elapsed, setElapsed] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [btWarning, setBtWarning] = useState<string | null>(null)
  // The app's audio session, when this page runs inside one. Null on the web.
  const [route, setRoute] = useState<RadioAudioState | null>(null)
  const [busy, setBusy] = useState(false)

  const captureRef = useRef<RadioCapture | null>(null)
  const queueRef = useRef<RadioPlayQueue | null>(null)
  const pressedRef = useRef(false)
  const theirTurnRef = useRef(false)
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  // The 60s cap fires from inside the capture engine, which is built in an effect
  // above where release() is declared. Reaching for it through a ref assigned after
  // every render keeps the effect off a value that doesn't exist yet.
  const releaseRef = useRef<() => void>(() => {})
  // The mic effect's open(), reachable from the native-interruption handler, which
  // lives in a different effect and has to reopen the mic when a call ends.
  const openMicRef = useRef<() => Promise<void>>(async () => {})

  // Mirrored for the press handler, which must see the CURRENT value rather than
  // the one captured when it was created.
  useEffect(() => { theirTurnRef.current = theirTurn }, [theirTurn])

  const status = state.session.status
  const isLive = status === 'active'

  // Hold the screen on while the channel is open. A radio you have to wake the
  // phone to answer is not a radio, and the OS sleep timer does not care that
  // audio is arriving. Released the moment the channel ends or the screen closes.
  useEffect(() => {
    if (!isLive) return
    return keepAwake()
  }, [isLive])

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/hub/radio/session/${sessionId}`)
    if (res.ok) setState(await res.json())
  }, [sessionId])

  // ---- realtime: the fast path. The rows stay the truth; a missed broadcast is
  // recovered by refresh() on resume. Handlers are released, never the channel.
  useEffect(() => {
    // Their turn starts twice over: 'talking-start' lands on the press (before any
    // audio exists) and the play queue starts when sound actually arrives. Whichever
    // is first owns the chirp — the ref is set synchronously so the second one in the
    // same tick sees it and stays quiet.
    const turnOn = () => {
      if (theirTurnRef.current) return
      theirTurnRef.current = true
      setTheirTurn(true)
      haptic('heavy')          // they have started talking
      playRadioTone('radio-incoming')
    }
    // The over beep. Not "they stopped" but "the channel is yours" — which is the
    // moment you need to know about without looking at the screen.
    const turnOff = () => {
      if (!theirTurnRef.current) return
      theirTurnRef.current = false
      setTheirTurn(false)
      haptic('light')          // over — the channel is yours
      playRadioTone('radio-over')
    }

    const queue = new RadioPlayQueue({
      onStart: turnOn,
      onFinish: turnOff,
    })
    queueRef.current = queue

    const release = subscribeSharedBroadcast(radioTopic(sessionId), {
      accepted: () => { setState(s => ({ ...s, session: { ...s.session, status: 'active' } })); void refresh() },
      declined: () => setState(s => ({ ...s, session: { ...s.session, status: 'declined' } })),
      closed: () => { queue.stop(); theirTurnRef.current = false; setTheirTurn(false); setState(s => ({ ...s, session: { ...s.session, status: 'closed' } })) },
      'talking-start': (payload) => {
        const p = (payload ?? {}) as { senderId?: string }
        if (p.senderId === state.me.id) return
        // Lock before any audio exists — that is what makes the far press feel instant.
        turnOn()
      },
      'piece-ready': (payload) => {
        const p = (payload ?? {}) as { senderId?: string; transmissionId?: string; seq?: number; pieceId?: string }
        if (p.senderId === state.me.id || !p.transmissionId || !p.pieceId || !p.seq) return
        queue.add({ transmissionId: p.transmissionId, seq: p.seq, pieceId: p.pieceId })
      },
      'transmission-end': (payload) => {
        const p = (payload ?? {}) as { senderId?: string; transmissionId?: string; pieceCount?: number | null }
        if (p.senderId === state.me.id || !p.transmissionId) return
        queue.end(p.transmissionId, p.pieceCount ?? null)
      },
    })
    return () => { release(); queue.stop() }
  }, [sessionId, state.me.id, refresh])

  // ---- the microphone: open while this screen is live and visible, closed otherwise.
  useEffect(() => {
    if (!isLive) return
    const cap = new RadioCapture({
      onCap: () => { setNotice('60 seconds is the limit — for anything longer, give them a call.'); releaseRef.current() },
      onPieceFailed: () => setNotice('Part of that didn’t send.'),
    })
    captureRef.current = cap
    let gone = false

    const open = async () => {
      // ⚠ The app's audio session goes into voice mode BEFORE the mic opens, so the
      // microphone is taken from the call-audio route (a Bluetooth earpiece) rather
      // than the default one. Idempotent natively; null on the web, which carries on
      // exactly as before. A refusal means a phone call owns the microphone, and
      // the channel waits for it rather than fighting a customer for the mic.
      let native: RadioAudioState | null = null
      try {
        native = await startRadioAudio()
        if (gone) return
      } catch (e) {
        if (gone) return
        setNotice(e instanceof RadioAudioRefused
          ? `${e.message} — Radio picks up again when it ends.`
          : 'Could not start the radio audio session.')
        return
      }
      setRoute(native)
      try {
        await cap.open()
        if (gone) { cap.close(); return }
        // The Bluetooth warning is about the WEB path. Inside the app's session a
        // headset holds — that is the whole point — so the warning would be a lie.
        setBtWarning(native ? null : bluetoothWarningFor(cap.mediaStream))
      } catch {
        setNotice('Microphone blocked — allow it in your browser settings to talk.')
      }
    }
    openMicRef.current = open
    const onVisibility = () => {
      if (document.hidden) cap.close()
      else void open()
    }
    void open()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      gone = true
      openMicRef.current = async () => {}
      document.removeEventListener('visibilitychange', onVisibility)
      cap.close()
      captureRef.current = null
    }
  }, [isLive])

  // ---- the app's audio session: held for the LIFE of the channel, not the
  // visibility of the screen. The mic above closes when the screen is hidden (a live
  // mic on a tab you switched away from is a trust problem); the session stays, so
  // audio keeps the call-style route and the door is open for playback with the
  // screen off, which is the pocket case the native release exists for. Declared
  // after the mic effect on purpose: cleanups run in order, so the mic is closed
  // before the session is handed back.
  useEffect(() => {
    if (!isLive) return
    let gone = false
    const offInterrupted = onRadioAudioEvent('interrupted', (data) => {
      if (gone) return
      if (data.active === true) {
        // Whatever took the microphone has let go. Pick the channel back up.
        setNotice(null)
        void openMicRef.current()
        return
      }
      // A real call, Siri, an alarm. A channel that looks live but cannot hear
      // anything is worse than one that says so — and a held button has to be
      // released, or the far end stays locked on "Ben is talking".
      releaseRef.current()
      captureRef.current?.close()
      setNotice('Radio paused — a call or another app took the microphone.')
    })
    const offRoute = onRadioAudioEvent('routeChanged', (data) => {
      if (gone) return
      setRoute({
        active: data.active === true,
        bluetooth: data.bluetooth === true,
        output: typeof data.output === 'string' ? data.output : '',
        input: typeof data.input === 'string' ? data.input : '',
      })
    })
    return () => {
      gone = true
      offInterrupted()
      offRoute()
      setRoute(null)
      void stopRadioAudio()
    }
  }, [isLive])

  // ---- the invite ring. The person being invited hears it; the one who opened the
  // channel does not — they know, they just pressed the button. Bounded in ring.ts.
  useEffect(() => {
    if (status === 'pending' && !state.me.isInitiator) startRadioInviteRing()
    else stopRadioInviteRing()
    return () => stopRadioInviteRing()
  }, [status, state.me.isInitiator])

  // ---- a channel goes quiet and closes itself; come back to a screen telling the truth.
  useEffect(() => {
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  async function press() {
    if (!isLive || pressedRef.current) return
    if (theirTurnRef.current) { haptic('error'); playRadioTone('radio-blocked'); setNotice(`${state.other.name} is talking.`); return }
    const cap = captureRef.current
    if (!cap) return
    pressedRef.current = true
    setNotice(null)
    haptic('medium')          // you are on

    // Capture from this instant; the transmission id catches up. Waiting on the
    // round trip would cost the first syllable.
    try { cap.begin() } catch { pressedRef.current = false; setNotice('Microphone isn’t ready yet.'); return }
    setTalking(true)
    setElapsed(0)
    holdTimer.current = setInterval(() => setElapsed(e => e + 100), 100)

    try {
      const res = await fetch('/api/hub/radio/transmission', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        cap.discard()
        pressedRef.current = false
        setTalking(false)
        if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null }
        haptic('error')
        playRadioTone('radio-blocked')
        setNotice(res.status === 409 ? (body.error ?? `${state.other.name} is talking.`) : 'Could not start — try again.')
        if (body.status && body.status !== 'active') setState(s => ({ ...s, session: { ...s.session, status: body.status } }))
        return
      }
      const { transmissionId } = await res.json()
      cap.attach(transmissionId)
    } catch {
      cap.discard(); pressedRef.current = false; setTalking(false)
      if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null }
      setNotice('No connection — that didn’t send.')
    }
  }

  async function release() {
    if (!pressedRef.current) return
    pressedRef.current = false
    const cap = captureRef.current
    if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null }
    setTalking(false)
    setElapsed(0)
    haptic('light')          // you are off
    if (!cap) return
    const { pieceCount, durationMs } = await cap.end()
    const transmissionId = cap.currentTransmissionId
    // ⚠ Send the end marker whenever a transmission exists, even with zero pieces.
    // talking-start already locked their button; the end marker is the ONLY thing
    // that retracts it, so an empty hold that returns early strands them on
    // "Ben is talking" until the channel expires.
    if (!transmissionId) return                 // discarded before the far end confirmed
    await fetch(`/api/hub/radio/transmission/${transmissionId}/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pieceCount, durationMs }),
    }).catch(() => { /* the receiver recovers on its next refresh */ })
  }

  useEffect(() => { releaseRef.current = () => { void release() } })

  async function act(path: 'accept' | 'decline' | 'close') {
    setBusy(true)
    try {
      queueRef.current?.unlock()           // this tap is our gesture for iOS audio
      const res = await fetch(`/api/hub/radio/session/${sessionId}/${path}`, { method: 'POST' })
      if (path === 'accept' && res.ok) { await refresh(); return }
      if (path === 'decline' || path === 'close') { router.push(`/hub/pm/${state.session.conversation_id}`); return }
      if (!res.ok) setNotice('That didn’t work — try again.')
    } finally { setBusy(false) }
  }

  // ---------------------------------------------------------------- rendering
  const shell = (children: React.ReactNode) => (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      <header className="flex-none flex items-center gap-2.5 border-b border-gray-800 px-5 py-3">
        <RadioIcon className="h-5 w-5 text-gray-400" />
        <h1 className="font-semibold">{state.other.name}</h1>
        <button
          type="button"
          onClick={() => router.push(`/hub/pm/${state.session.conversation_id}`)}
          className="ml-auto text-sm text-gray-400 hover:text-white"
        >
          Back to chat
        </button>
      </header>
      {children}
    </div>
  )

  if (status === 'pending') {
    return shell(
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
        {state.me.isInitiator ? (
          <>
            <RadioIcon className="h-14 w-14 text-gray-600" />
            <p className="text-lg text-gray-300">Waiting for {state.other.name} to accept…</p>
            <p className="text-sm text-gray-500">They’ll get one notification. There’s no ringing.</p>
            <button type="button" onClick={() => act('close')} disabled={busy}
              className="mt-2 rounded-xl border border-gray-700 px-5 py-3 text-sm text-gray-300 disabled:opacity-50">
              Cancel
            </button>
          </>
        ) : (
          <>
            <RadioIcon className="h-14 w-14 text-blue-400" />
            <p className="text-lg"><span className="font-semibold">{state.other.name}</span> wants to open a radio channel</p>
            <p className="text-sm text-gray-500">
              Press and hold to talk for the next hour. Nothing is recorded or kept.
            </p>
            <div className="flex gap-3 mt-2">
              <button type="button" onClick={() => act('accept')} disabled={busy}
                className="rounded-xl bg-blue-600 px-6 py-3 font-semibold disabled:opacity-50">Accept</button>
              <button type="button" onClick={() => act('decline')} disabled={busy}
                className="rounded-xl border border-gray-700 px-6 py-3 text-gray-300 disabled:opacity-50">Not now</button>
            </div>
          </>
        )}
      </div>
    )
  }

  if (!isLive) {
    const msg =
      status === 'declined' ? `${state.other.name} isn’t available right now.`
      : status === 'expired' ? 'That channel closed after an hour of quiet.'
      : 'The channel is closed.'
    return shell(
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
        <RadioIcon className="h-14 w-14 text-gray-700" />
        <p className="text-lg text-gray-300">{msg}</p>
        <button type="button" onClick={() => router.push(`/hub/pm/${state.session.conversation_id}`)}
          className="rounded-xl border border-gray-700 px-5 py-3 text-sm text-gray-300">Back to chat</button>
      </div>
    )
  }

  const seconds = Math.floor(elapsed / 1000)
  const amber = elapsed >= AMBER_AT_MS
  const closesAt = state.expiresAt
    ? new Date(state.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null

  return shell(
    <div className="flex-1 flex flex-col px-4 pb-4 gap-3 min-h-0">
      {btWarning && (
        <p className="flex-none rounded-lg bg-amber-500/10 border border-amber-500/40 px-3 py-2 text-xs text-amber-300">
          {btWarning}
        </p>
      )}
      {!btWarning && route?.bluetooth && (
        <p className="flex-none rounded-lg bg-gray-800/80 border border-gray-700 px-3 py-2 text-xs text-gray-300">
          🎧 Through {route.output || route.input || 'your headset'}
        </p>
      )}

      <button
        type="button"
        onPointerDown={e => { e.preventDefault(); void press() }}
        onPointerUp={e => { e.preventDefault(); void release() }}
        onPointerCancel={() => { void release() }}
        onPointerLeave={() => { if (pressedRef.current) void release() }}
        onContextMenu={e => e.preventDefault()}
        disabled={theirTurn}
        aria-label={theirTurn ? `${state.other.name} is talking` : 'Press and hold to talk'}
        className={`flex-1 min-h-0 w-full rounded-3xl flex flex-col items-center justify-center gap-3 select-none touch-none transition-colors
          ${theirTurn ? 'bg-emerald-700/80' : talking ? (amber ? 'bg-amber-600' : 'bg-red-600') : 'bg-gray-800'}`}
        style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
      >
        {theirTurn ? (
          <>
            <SpeakerIcon className="h-20 w-20" />
            <span className="text-xl font-semibold">{state.other.name} is talking</span>
          </>
        ) : talking ? (
          <>
            <MicIcon className="h-20 w-20" />
            <span className="text-xl font-semibold tabular-nums">{seconds}s</span>
            <span className="text-sm opacity-80">
              {amber ? 'Nearly at the limit' : 'Let go to send'}
            </span>
          </>
        ) : (
          <>
            <MicIcon className="h-20 w-20 text-gray-300" />
            <span className="text-xl font-semibold text-gray-200">Hold to talk</span>
          </>
        )}
      </button>

      <p className="flex-none min-h-[1.25rem] text-center text-xs text-gray-400">
        {notice ?? (closesAt ? `Closes at ${closesAt} unless someone talks` : ' ')}
      </p>

      <button type="button" onClick={() => act('close')} disabled={busy}
        className="flex-none rounded-xl border border-gray-700 py-3 text-sm text-gray-300 disabled:opacity-50">
        Close channel
      </button>
    </div>
  )
}
