'use client'

// The radio, Hub-wide. One per page load, mounted in the Hub layout ABOVE every page,
// so a channel keeps talking and listening while you move around the Hub — open a
// Work Order stop, check a customer, read a text — instead of only while the Radio
// screen is open. (A technician's question at the Oct 13 2026 crew meeting: "what if
// you need to be in another area of the Hub while you're talking?")
//
// Two windows onto this one engine: the radio bar along the top of every Hub page
// (RadioBar) and the full Radio screen (RadioScreen). Neither owns any audio.
//
// Before this, the Radio screen held the microphone and the player itself, and
// dropped the mic whenever it was hidden, because Workspace Tabs keep hidden pages
// mounted and a live mic in a tab you switched away from is a trust problem. One
// engine above the tabs removes that trap rather than working around it: there is
// exactly one microphone owner, and it follows whether the APP is on screen, not
// which page is.
//
// One device per person runs the audio. A person can have the Hub on a laptop and
// in the phone app at once; both playing every word, and both holding a mic, would
// be worse than useless. The device in use is whichever last opened the channel
// screen, accepted, or tapped "Use here" — remembered in this browser, announced to
// the person's other devices (POST .../here), and inside one browser handed to the
// tab you're looking at (Web Locks). Every other device shows the bar with "Use here".

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { subscribeSharedBroadcast } from '@/lib/realtime-shared-channel'
import { RadioCapture, bluetoothWarningFor } from '@/lib/radio/capture'
import { RadioPlayQueue, unlockRadioAudio } from '@/lib/radio/playQueue'
import { RADIO_CHANNEL_TTL_LABEL, RADIO_CHANNEL_TTL_MS, radioTopic, radioUserTopic, type RadioStatus } from '@/lib/radio/types'
import { haptic, keepAwake } from '@/lib/native-device'
import { startRadioAudio, stopRadioAudio, onRadioAudioEvent, RadioAudioRefused, type RadioAudioState } from '@/lib/native-radio-audio'
import { playRadioTone } from '@/lib/hub-chime'
import { useToast } from '@/components/ui/Toast'

export type RadioChannel = {
  sessionId: string
  conversationId: string
  expiresAt: string | null
  me: { id: string; name: string; isInitiator: boolean }
  other: { id: string; name: string }
}

export type RadioEnded = { sessionId: string; reason: 'closed' | 'expired' }

export type RadioApi = {
  /** The live channel you're on, wherever it's playing. Null when there isn't one. */
  channel: RadioChannel | null
  /** This device AND this tab are the ones talking and listening. */
  here: boolean
  /** The channel is live but plays somewhere else — 'tab' = another tab in this browser. */
  elsewhere: 'device' | 'tab' | null
  talking: boolean
  theirTurn: boolean
  elapsed: number
  notice: string | null
  btWarning: string | null
  /** The app's audio session route, when running inside one. Null on the web. */
  route: RadioAudioState | null
  /** On a Dialer call: radio holds what arrives and keeps the mic closed until it ends. */
  onCall: boolean
  /** The last channel that ended under us, so its screen can say how. */
  ended: RadioEnded | null
  press: () => Promise<void>
  release: () => Promise<void>
  /** Ends the channel for both people. True once it's closed. */
  close: () => Promise<boolean>
  /** Use this channel on this device and tab. Only for a LIVE channel — claiming is
   *  per person, so claiming an invite would take the radio off the one you're on. */
  claimHere: (sessionId: string) => void
  /** You opened this invite here: if it's accepted, use it here. */
  expectHere: (sessionId: string) => void
  /** Load one channel by id — after an accept, or when its screen opens. */
  adopt: (sessionId: string) => Promise<void>
  setOnCall: (onCall: boolean) => void
}

const RadioContext = createContext<RadioApi | null>(null)

/** Null outside the Hub, or for someone without Radio. */
export function useRadio(): RadioApi | null {
  return useContext(RadioContext)
}

export default function RadioProvider({ enabled, currentUserId, children }: { enabled: boolean; currentUserId: string; children: ReactNode }) {
  if (!enabled) return <>{children}</>
  return <RadioEngine currentUserId={currentUserId}>{children}</RadioEngine>
}

// ---------------------------------------------------------------- this device

const DEVICE_KEY = 'lx-radio-device'
const HERE_KEY = 'lx-radio-here'
const EXPECT_KEY = 'lx-radio-expect'   // an invite you sent from this device, not answered yet

function readLS(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeLS(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* private mode — this tab still works */ }
}

let deviceIdMemo: string | null = null
/** A random label for this browser. Not an identity — only "is that me or my other device?". */
function myDeviceId(): string {
  if (deviceIdMemo) return deviceIdMemo
  let id = readLS(DEVICE_KEY)
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    writeLS(DEVICE_KEY, id)
  }
  deviceIdMemo = id
  return id
}

/**
 * Which tab in this browser runs the audio. The tab you're looking at takes it; a tab
 * that loses it waits in line and gets it back when the other one closes. Browsers
 * without Web Locks (old ones) treat every tab as the holder — the pre-bar behaviour.
 * Returns [held, take] — take() grabs it now, for an explicit "Use here".
 */
function useTabLock(name: string | null): [boolean, () => void] {
  const [held, setHeld] = useState(false)
  const takeRef = useRef<() => void>(() => {})

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined

  useEffect(() => {
    if (!name || !locks) { takeRef.current = () => {}; return }

    let gone = false
    let holding = false
    let release: (() => void) | null = null
    let waiting: AbortController | null = null

    const take = (steal: boolean) => {
      let ctrl: AbortController | null = null
      if (steal) { waiting?.abort(); waiting = null }
      else { ctrl = new AbortController(); waiting = ctrl }
      locks.request(name, steal ? { steal: true } : { signal: ctrl!.signal }, () => new Promise<void>(resolve => {
        if (ctrl && waiting === ctrl) waiting = null
        if (gone) { resolve(); return }
        release = resolve
        holding = true
        setHeld(true)
      })).catch(() => {
        // Aborted by us (we're stealing instead) — nothing to do. Otherwise another tab
        // stole it because you looked at that one: step back and queue to get it back.
        if (gone || ctrl?.signal.aborted) return
        release?.(); release = null
        holding = false
        setHeld(false)
        take(false)
      })
    }

    take(document.visibilityState === 'visible')
    const onVisible = () => { if (document.visibilityState === 'visible' && !holding) take(true) }
    document.addEventListener('visibilitychange', onVisible)
    takeRef.current = () => { if (!holding) take(true) }

    return () => {
      gone = true
      document.removeEventListener('visibilitychange', onVisible)
      waiting?.abort()
      release?.()
      takeRef.current = () => {}
      setHeld(false)
    }
  }, [name, locks])

  const take = useCallback(() => takeRef.current(), [])
  return [!!name && (held || !locks), take]
}

// ---------------------------------------------------------------- the engine

/** One press-and-hold, tracked here rather than read back off the capture engine:
 *  closing the mic clears the capture's own transmission id, and the end marker
 *  must still go out — it is the ONLY thing that unlocks the far end's button. */
type Hold = {
  cap: RadioCapture
  transmissionId: string | null
  /** The server has answered the start (with an id, or a refusal). */
  settled: boolean
  released: boolean
  result: { pieceCount: number; durationMs: number } | null
  endSent: boolean
}

function sendEnd(transmissionId: string, result: { pieceCount: number; durationMs: number }) {
  return fetch(`/api/hub/radio/transmission/${transmissionId}/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  }).catch(() => { /* the receiver recovers on its next refresh */ })
}

function RadioEngine({ currentUserId, children }: { currentUserId: string; children: ReactNode }) {
  // Through a ref: the toast API object is rebuilt whenever a toast shows, and the
  // callbacks below must stay put or the subscriptions that depend on them churn.
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast }, [toast])
  const [channel, setChannelState] = useState<RadioChannel | null>(null)
  const [ended, setEnded] = useState<RadioEnded | null>(null)
  const [claimedId, setClaimedId] = useState<string | null>(() => readLS(HERE_KEY))
  const [talking, setTalking] = useState(false)
  const [theirTurn, setTheirTurn] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [notice, setNoticeState] = useState<string | null>(null)
  const [btWarning, setBtWarning] = useState<string | null>(null)
  const [route, setRoute] = useState<RadioAudioState | null>(null)
  const [onCall, setOnCallState] = useState(false)

  const channelRef = useRef<RadioChannel | null>(null)
  const captureRef = useRef<RadioCapture | null>(null)
  const queueRef = useRef<RadioPlayQueue | null>(null)
  const pressedRef = useRef(false)
  const holdRef = useRef<Hold | null>(null)
  const theirTurnRef = useRef(false)
  const hereRef = useRef(false)
  const onCallRef = useRef(false)
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnOnRef = useRef<() => void>(() => {})
  // release() is declared below the effects that need it (the 60 s cap, a call
  // taking the mic); they reach it through this ref, assigned after every render.
  const releaseRef = useRef<() => void>(() => {})
  // The mic effect's open(), for the native-interruption handler in another effect.
  const openMicRef = useRef<() => Promise<void>>(async () => {})

  const sessionId = channel?.sessionId ?? null
  const claimed = !!sessionId && claimedId === sessionId
  const [lockHeld, takeLock] = useTabLock(claimed ? `lx-radio:${sessionId}` : null)
  const here = claimed && lockHeld
  useEffect(() => { hereRef.current = here }, [here])
  useEffect(() => { onCallRef.current = onCall }, [onCall])

  const setChannel = useCallback((next: RadioChannel | null) => {
    channelRef.current = next
    setChannelState(next)
  }, [])

  /** A sticky notice stays until the next press; a flash clears itself. */
  const setNotice = useCallback((text: string | null, flashMs?: number) => {
    if (noticeTimer.current) { clearTimeout(noticeTimer.current); noticeTimer.current = null }
    setNoticeState(text)
    if (text && flashMs) noticeTimer.current = setTimeout(() => setNoticeState(null), flashMs)
  }, [])

  /** The channel is over — closed by someone, or gone quiet. */
  const endChannel = useCallback((sid: string, reason: RadioEnded['reason'], byMe: boolean) => {
    const ch = channelRef.current
    if (!ch || ch.sessionId !== sid) return
    const wasHere = hereRef.current
    setChannel(null)
    setEnded({ sessionId: sid, reason })
    setNotice(null)
    if (readLS(HERE_KEY) === sid) writeLS(HERE_KEY, null)
    setClaimedId(id => (id === sid ? null : id))
    // The channel screen says this itself; anywhere else the bar just vanishing
    // would leave you wondering whether you'd lost signal.
    const onItsScreen = typeof window !== 'undefined' && window.location.pathname.startsWith(`/hub/radio/${sid}`)
    if (wasHere && !byMe && !onItsScreen) {
      toastRef.current.info(reason === 'expired'
        ? `Radio with ${ch.other.name} closed after ${RADIO_CHANNEL_TTL_LABEL} of quiet`
        : `${ch.other.name} closed the radio channel`)
    }
  }, [setChannel, setNotice])

  /** Pushes the "closes at" time forward — every transmission restarts the quiet clock. */
  const bumpExpiry = useCallback((sid: string) => {
    const ch = channelRef.current
    if (!ch || ch.sessionId !== sid) return
    setChannel({ ...ch, expiresAt: new Date(Date.now() + RADIO_CHANNEL_TTL_MS).toISOString() })
  }, [setChannel])

  const claimHere = useCallback((sid: string) => {
    writeLS(HERE_KEY, sid)
    setClaimedId(sid)
    takeLock()                 // same channel already claimed in this browser → take it from the other tab
    void fetch(`/api/hub/radio/session/${sid}/here`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: myDeviceId() }),
    }).catch(() => { /* the other device steps back next time it hears */ })
  }, [takeLock])

  const expectHere = useCallback((sid: string) => writeLS(EXPECT_KEY, sid), [])

  const adopt = useCallback(async (sid: string) => {
    const res = await fetch(`/api/hub/radio/session/${sid}`, { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return
    const body = await res.json() as {
      session: { id: string; conversation_id: string; status: RadioStatus; closed_by: string | null }
      expiresAt: string | null
      me: RadioChannel['me']
      other: RadioChannel['other']
    }
    if (body.session.status === 'active') {
      const cur = channelRef.current
      setChannel({
        sessionId: body.session.id,
        conversationId: body.session.conversation_id,
        expiresAt: body.expiresAt,
        me: body.me,
        other: body.other,
      })
      if (!cur || cur.sessionId !== sid) setEnded(null)
      // Your invite, sent from this device, was just accepted — so it plays here.
      if (readLS(EXPECT_KEY) === sid) { writeLS(EXPECT_KEY, null); claimHere(sid) }
    } else if (channelRef.current?.sessionId === sid && (body.session.status === 'closed' || body.session.status === 'expired')) {
      endChannel(sid, body.session.status, body.session.closed_by === currentUserId)
    }
  }, [setChannel, endChannel, currentUserId, claimHere])

  /** The rows are the truth; this reconciles with them after anything might have been missed. */
  const refresh = useCallback(async () => {
    const cur = channelRef.current
    if (cur) { await adopt(cur.sessionId); if (channelRef.current) return }
    const res = await fetch('/api/hub/radio/session', { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return
    const { channel: next } = await res.json() as { channel: RadioChannel | null }
    if (next && !channelRef.current) { setChannel(next); setEnded(null) }
  }, [adopt, setChannel])


  const setOnCall = useCallback((v: boolean) => setOnCallState(v), [])

  // ---- finding the channel: on load, coming back to the app, and on the person's
  // own topic (the far end accepted your invite; a channel you're on was closed).
  useEffect(() => {
    void refresh()
    const onBack = () => { if (document.visibilityState === 'visible') void refresh() }
    const onStorage = (e: StorageEvent) => { if (e.key === HERE_KEY) setClaimedId(e.newValue) }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('storage', onStorage)
    const off = subscribeSharedBroadcast(radioUserTopic(currentUserId), {
      accepted: (payload) => {
        const p = (payload ?? {}) as { sessionId?: string }
        if (p.sessionId) void adopt(p.sessionId)
      },
      closed: (payload) => {
        const p = (payload ?? {}) as { sessionId?: string; byId?: string }
        if (p.sessionId) endChannel(p.sessionId, 'closed', p.byId === currentUserId)
      },
    })
    return () => {
      off()
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('storage', onStorage)
    }
  }, [currentUserId, refresh, adopt, endChannel])

  // ---- a quiet channel closes itself on the server's clock, which tells nobody.
  // Check back just after it should have closed; a transmission meanwhile will have
  // moved expiresAt and this re-arms.
  // The tick re-arms it when the server still says "open" (this phone's clock runs
  // a little ahead of the server's) and hands back the same time.
  const expiresAt = channel?.expiresAt ?? null
  const [expiryTick, setExpiryTick] = useState(0)
  useEffect(() => {
    if (!expiresAt) return
    const wait = Math.min(Math.max(Date.parse(expiresAt) - Date.now() + 1500, 5000), 2 ** 31 - 1)
    const t = setTimeout(() => { void refresh().then(() => setExpiryTick(n => n + 1)) }, wait)
    return () => clearTimeout(t)
  }, [expiresAt, expiryTick, refresh])

  // ---- everything inside the channel. The rows stay the truth; a missed broadcast
  // is recovered by refresh(). Handlers are released, never the channel.
  useEffect(() => {
    if (!sessionId) return
    return subscribeSharedBroadcast(radioTopic(sessionId), {
      closed: (payload) => {
        const p = (payload ?? {}) as { byId?: string }
        endChannel(sessionId, 'closed', p.byId === currentUserId)
      },
      'talking-start': (payload) => {
        const p = (payload ?? {}) as { senderId?: string }
        bumpExpiry(sessionId)
        // Lock before any audio exists — that is what makes the far press feel instant.
        if (p.senderId !== currentUserId) turnOnRef.current()
      },
      'piece-ready': (payload) => {
        const p = (payload ?? {}) as { senderId?: string; transmissionId?: string; seq?: number; pieceId?: string }
        if (p.senderId === currentUserId || !p.transmissionId || !p.pieceId || !p.seq) return
        queueRef.current?.add({ transmissionId: p.transmissionId, seq: p.seq, pieceId: p.pieceId })
      },
      'transmission-end': (payload) => {
        const p = (payload ?? {}) as { senderId?: string; transmissionId?: string; pieceCount?: number | null }
        bumpExpiry(sessionId)
        if (p.senderId === currentUserId || !p.transmissionId) return
        queueRef.current?.end(p.transmissionId, p.pieceCount ?? null)
      },
      // You took the channel on another device — this one steps back.
      device: (payload) => {
        const p = (payload ?? {}) as { userId?: string; deviceId?: string }
        if (p.userId !== currentUserId || !p.deviceId || p.deviceId === myDeviceId()) return
        if (readLS(HERE_KEY) === sessionId) writeLS(HERE_KEY, null)
        setClaimedId(id => (id === sessionId ? null : id))
      },
    })
  }, [sessionId, currentUserId, endChannel, bumpExpiry])

  // ---- from here down, only the device + tab in use.

  // Hold the screen on while the channel is open here. A radio you have to wake the
  // phone to answer is not a radio, and the OS sleep timer does not care that audio
  // is arriving. Native only (see keepAwake).
  useEffect(() => {
    if (!here) return
    return keepAwake()
  }, [here])

  // Any tap anywhere while a channel is open counts as the gesture iOS wants.
  useEffect(() => {
    if (!here) return
    const unlock = () => unlockRadioAudio()
    document.addEventListener('click', unlock, true)
    document.addEventListener('touchend', unlock, true)
    return () => {
      document.removeEventListener('click', unlock, true)
      document.removeEventListener('touchend', unlock, true)
    }
  }, [here])

  // The player. Their turn starts twice over: 'talking-start' lands on the press
  // (before any audio exists) and the queue starts when sound actually arrives.
  // Whichever is first owns the chirp — the ref is set synchronously so the second
  // one in the same tick sees it and stays quiet.
  useEffect(() => {
    if (!here) return
    const turnOn = () => {
      if (theirTurnRef.current) return
      theirTurnRef.current = true
      setTheirTurn(true)
      if (onCallRef.current) return   // the customer doesn't need to hear our chirps
      haptic('heavy')          // they have started talking
      playRadioTone('radio-incoming')
    }
    // The over beep. Not "they stopped" but "the channel is yours" — which is the
    // moment you need to know about without looking at the screen.
    const turnOff = () => {
      if (!theirTurnRef.current) return
      theirTurnRef.current = false
      setTheirTurn(false)
      if (onCallRef.current) return
      haptic('light')          // over — the channel is yours
      playRadioTone('radio-over')
    }
    const queue = new RadioPlayQueue({ onStart: turnOn, onFinish: turnOff })
    queueRef.current = queue
    turnOnRef.current = turnOn
    return () => {
      queue.stop()
      queueRef.current = null
      turnOnRef.current = () => {}
      theirTurnRef.current = false
      setTheirTurn(false)
    }
  }, [here, sessionId])

  // On a Dialer call the speaker belongs to the customer. Hold what arrives and play
  // it after; let go of a held button so the far end isn't locked on "Ben is talking".
  useEffect(() => {
    queueRef.current?.setPaused(onCall)
    if (onCall) releaseRef.current()
  }, [onCall, here, sessionId])

  // The microphone: ready while the channel is in use here, the app is on screen and
  // no call has it. Ready rather than opened on the press, because opening costs the
  // first half-second of what you say. Closed the moment the app goes to the back.
  useEffect(() => {
    if (!here || onCall) return
    const cap = new RadioCapture({
      onCap: () => { setNotice('60 seconds is the limit — for anything longer, give them a call.'); releaseRef.current() },
      onPieceFailed: () => setNotice('Part of that didn’t send.', 6000),
    })
    captureRef.current = cap
    let gone = false

    const open = async () => {
      // Never from the background — a tab that inherits the radio from one you just
      // closed, or a channel picked up while the app is behind another, waits until
      // it's looked at (onVisibility below opens it then).
      if (document.hidden) return
      // ⚠ The app's audio session goes into voice mode BEFORE the mic opens, so the
      // microphone is taken from the call-audio route (a Bluetooth earpiece) rather
      // than the default one. Idempotent natively; null on the web, which carries on
      // exactly as before. A refusal means a phone call owns the microphone, and the
      // channel waits for it rather than fighting a customer for the mic.
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
        // Gone, or sent to the back while the mic was still being granted.
        if (gone || document.hidden) { cap.close(); return }
        // The Bluetooth warning is about the WEB path. Inside the app's session a
        // headset holds — that is the whole point — so the warning would be a lie.
        setBtWarning(native ? null : bluetoothWarningFor(cap.mediaStream))
      } catch {
        setNotice('Microphone blocked — allow it in your browser settings to talk.')
      }
    }
    openMicRef.current = open
    const onVisibility = () => {
      if (document.hidden) { releaseRef.current(); cap.close() }   // the hold's end marker survives close (see Hold)
      else void open()
    }
    void open()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      gone = true
      openMicRef.current = async () => {}
      document.removeEventListener('visibilitychange', onVisibility)
      releaseRef.current()
      cap.close()
      captureRef.current = null
    }
  }, [here, onCall, setNotice])

  // The app's audio session: held for the LIFE of the channel here, not the
  // visibility of the app, so audio keeps the call-style route and the door is open
  // for playback with the screen off — the pocket case the native release exists
  // for. Declared after the mic effect on purpose: cleanups run in order, so the mic
  // is closed before the session is handed back.
  useEffect(() => {
    if (!here) return
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
      setBtWarning(null)
      void stopRadioAudio()
    }
  }, [here, setNotice])

  // ---------------------------------------------------------------- talking

  const press = useCallback(async () => {
    const ch = channelRef.current
    if (!ch || !hereRef.current || pressedRef.current) return
    unlockRadioAudio()
    if (theirTurnRef.current) {
      haptic('error'); playRadioTone('radio-blocked')
      setNotice(`${ch.other.name} is talking.`, 4000)
      return
    }
    // The last hold is still waiting on the server to answer its start. A new one
    // now would reset the capture under it and hand it the wrong transmission id.
    if (holdRef.current && !holdRef.current.settled) return
    const cap = captureRef.current
    if (!cap) return
    pressedRef.current = true
    setNotice(null)
    haptic('medium')          // you are on

    // Capture from this instant; the transmission id catches up. Waiting on the
    // round trip would cost the first syllable.
    try { cap.begin() } catch { pressedRef.current = false; setNotice('Microphone isn’t ready yet.', 4000); return }
    const hold: Hold = { cap, transmissionId: null, settled: false, released: false, result: null, endSent: false }
    holdRef.current = hold
    setTalking(true)
    setElapsed(0)
    holdTimer.current = setInterval(() => setElapsed(e => e + 100), 100)

    const refused = (msg: string) => {
      hold.settled = true
      cap.discard()
      if (!hold.released) {
        hold.released = true
        pressedRef.current = false
        setTalking(false)
        if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null }
      }
      haptic('error')
      playRadioTone('radio-blocked')
      setNotice(msg, 5000)
    }
    try {
      const res = await fetch('/api/hub/radio/transmission', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: ch.sessionId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        refused(res.status === 409 ? (body.error ?? `${ch.other.name} is talking.`) : 'Could not start — try again.')
        if (body.status === 'closed' || body.status === 'expired') endChannel(ch.sessionId, body.status, false)
        return
      }
      const { transmissionId } = await res.json() as { transmissionId: string }
      hold.transmissionId = transmissionId
      hold.settled = true
      cap.attach(transmissionId)          // sends what was recorded while we waited — if the mic is still open
      // Let go before the server answered: release() couldn't send the end marker
      // without an id, so it goes now. If the mic was dropped meanwhile, what was
      // waiting went with it — say zero pieces so the far end doesn't wait for them.
      if (hold.released && hold.result && !hold.endSent) {
        hold.endSent = true
        void sendEnd(transmissionId, cap.isOpen ? hold.result : { ...hold.result, pieceCount: 0 })
      }
    } catch {
      refused('No connection — that didn’t send.')
    }
  }, [setNotice, endChannel])

  const release = useCallback(async () => {
    const hold = holdRef.current
    if (!pressedRef.current || !hold || hold.released) return
    pressedRef.current = false
    hold.released = true
    if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null }
    setTalking(false)
    setElapsed(0)
    haptic('light')          // you are off
    hold.result = await hold.cap.end()
    // ⚠ Send the end marker whenever a transmission exists, even with zero pieces.
    // talking-start already locked their button; the end marker is the ONLY thing
    // that retracts it, so an empty hold that returns early strands them on
    // "Ben is talking". No id yet → press() sends it when the id arrives.
    if (hold.transmissionId && !hold.endSent) {
      hold.endSent = true
      await sendEnd(hold.transmissionId, hold.result)
    }
  }, [])

  useEffect(() => { releaseRef.current = () => { void release() } }, [release])

  const close = useCallback(async () => {
    const ch = channelRef.current
    if (!ch) return true
    await release()
    const res = await fetch(`/api/hub/radio/session/${ch.sessionId}/close`, { method: 'POST' }).catch(() => null)
    if (!res || !res.ok) { setNotice('That didn’t work — try again.', 5000); return false }
    endChannel(ch.sessionId, 'closed', true)
    return true
  }, [release, setNotice, endChannel])

  const api: RadioApi = {
    channel,
    here,
    elsewhere: channel && !here ? (claimed ? 'tab' : 'device') : null,
    talking,
    theirTurn,
    elapsed,
    notice,
    btWarning,
    route,
    onCall,
    ended,
    press,
    release,
    close,
    claimHere,
    expectHere,
    adopt,
    setOnCall,
  }

  return <RadioContext.Provider value={api}>{children}</RadioContext.Provider>
}
