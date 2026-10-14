'use client'

// The Radio screen: near-full-screen, thumb-first, usable with a glove on and the
// phone at your hip. Design: Hub/HUB_RADIO_PRD.md.
//
// The channel is server state and stays open until it goes quiet; the talking and
// listening live in RadioProvider, above every Hub page. This screen is the big
// window onto it — the radio bar along the top of every other Hub page is the small
// one — so leaving it keeps the channel playing and the talk button in reach.
//
// What this screen still owns is everything BEFORE a channel is live (the invite,
// accept / not now, waiting for them) and saying how it ended.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeSharedBroadcast } from '@/lib/realtime-shared-channel'
import { unlockRadioAudio } from '@/lib/radio/playQueue'
import { RADIO_CHANNEL_TTL_LABEL, radioTopic, type RadioStatus } from '@/lib/radio/types'
import { startRadioInviteRing, stopRadioInviteRing } from '@/lib/radio/ring'
import { useRadio } from './RadioProvider'
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
  const radio = useRadio()
  const [shownStatus, setStatus] = useState<RadioStatus>(initial.session.status)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { me, other } = initial
  const chatHref = `/hub/pm/${initial.session.conversation_id}`

  // The engine may have seen it end first (a missed broadcast, or the quiet clock ran out).
  const ended = radio?.ended
  const status: RadioStatus = ended?.sessionId === sessionId ? ended.reason : shownStatus

  const claimHere = radio?.claimHere
  const expectHere = radio?.expectHere
  const adopt = radio?.adopt
  const claimedFor = useRef<string | null>(null)

  // Opening a LIVE channel's screen on a device means using it there — so a channel
  // you opened on the laptop moves to your phone when you open it there. An invite
  // doesn't claim anything (that would take the radio off a channel you're already
  // on); the one you SENT is remembered, so it plays here once they accept.
  useEffect(() => {
    if (!claimHere || !expectHere || !adopt) return
    if (status === 'pending' && me.isInitiator) expectHere(sessionId)
    if (status !== 'active') return
    if (claimedFor.current !== sessionId) {
      claimedFor.current = sessionId
      claimHere(sessionId)
    }
    void adopt(sessionId)
  }, [sessionId, status, me.isInitiator, claimHere, expectHere, adopt])

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/hub/radio/session/${sessionId}`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setStatus((await res.json()).session.status)
  }, [sessionId])

  // ---- before and after the live part: accepted, turned down, closed.
  useEffect(() => {
    return subscribeSharedBroadcast(radioTopic(sessionId), {
      accepted: () => setStatus('active'),
      declined: () => setStatus('declined'),
      closed: () => setStatus('closed'),
    })
  }, [sessionId])

  // A channel goes quiet and closes itself; come back to a screen telling the truth.
  useEffect(() => {
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])


  // ---- the invite ring. The person being invited hears it; the one who opened the
  // channel does not — they know, they just pressed the button. Bounded in ring.ts.
  useEffect(() => {
    if (status === 'pending' && !me.isInitiator) startRadioInviteRing()
    else stopRadioInviteRing()
    return () => stopRadioInviteRing()
  }, [status, me.isInitiator])

  async function act(path: 'accept' | 'decline' | 'close') {
    setBusy(true)
    try {
      unlockRadioAudio()                   // this tap is our gesture for iOS audio
      if (path === 'close' && status === 'active' && radio) {
        if (await radio.close()) router.push(chatHref)
        return
      }
      const res = await fetch(`/api/hub/radio/session/${sessionId}/${path}`, { method: 'POST' })
      if (path === 'accept' && res.ok) { setStatus('active'); return }
      if (path === 'decline' || path === 'close') { router.push(chatHref); return }
      if (!res.ok) setNotice('That didn’t work — try again.')
    } finally { setBusy(false) }
  }

  // ---------------------------------------------------------------- rendering
  const shell = (children: React.ReactNode) => (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      <header className="flex-none flex items-center gap-2.5 border-b border-gray-800 px-5 py-3">
        <RadioIcon className="h-5 w-5 text-gray-400" />
        <h1 className="font-semibold">{other.name}</h1>
        <button type="button" onClick={() => router.push(chatHref)} className="ml-auto text-sm text-gray-400 hover:text-white">
          Back to chat
        </button>
      </header>
      {children}
    </div>
  )

  if (status === 'pending') {
    return shell(
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
        {me.isInitiator ? (
          <>
            <RadioIcon className="h-14 w-14 text-gray-600" />
            <p className="text-lg text-gray-300">Waiting for {other.name} to accept…</p>
            <p className="text-sm text-gray-500">They’ll get one notification. There’s no ringing.</p>
            <button type="button" onClick={() => act('close')} disabled={busy}
              className="mt-2 rounded-xl border border-gray-700 px-5 py-3 text-sm text-gray-300 disabled:opacity-50">
              Cancel
            </button>
          </>
        ) : (
          <>
            <RadioIcon className="h-14 w-14 text-blue-400" />
            <p className="text-lg"><span className="font-semibold">{other.name}</span> wants to open a radio channel</p>
            <p className="text-sm text-gray-500">
              Press and hold to talk. It stays open until nobody has talked for {RADIO_CHANNEL_TTL_LABEL}. Nothing is recorded or kept.
            </p>
            <div className="flex gap-3 mt-2">
              <button type="button" onClick={() => act('accept')} disabled={busy}
                className="rounded-xl bg-blue-600 px-6 py-3 font-semibold disabled:opacity-50">Accept</button>
              <button type="button" onClick={() => act('decline')} disabled={busy}
                className="rounded-xl border border-gray-700 px-6 py-3 text-gray-300 disabled:opacity-50">Not now</button>
            </div>
            {notice && <p className="text-sm text-amber-300">{notice}</p>}
          </>
        )}
      </div>
    )
  }

  if (status !== 'active') {
    const msg =
      status === 'declined' ? `${other.name} isn’t available right now.`
      : status === 'expired' ? `That channel closed after ${RADIO_CHANNEL_TTL_LABEL} of quiet.`
      : 'The channel is closed.'
    return shell(
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
        <RadioIcon className="h-14 w-14 text-gray-700" />
        <p className="text-lg text-gray-300">{msg}</p>
        <button type="button" onClick={() => router.push(chatHref)}
          className="rounded-xl border border-gray-700 px-5 py-3 text-sm text-gray-300">Back to chat</button>
      </div>
    )
  }

  // Live — but the engine may still be loading it (a moment after Accept).
  const live = radio?.channel?.sessionId === sessionId ? radio : null
  if (!live) {
    return shell(
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <RadioIcon className="h-14 w-14 text-gray-600 animate-pulse" />
        <p className="text-gray-400">Connecting…</p>
      </div>
    )
  }

  if (!live.here) {
    return shell(
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
        <RadioIcon className="h-14 w-14 text-gray-600" />
        <p className="text-lg text-gray-300">
          This channel is playing {live.elsewhere === 'tab' ? 'in another tab' : 'on your other device'}.
        </p>
        <button type="button" onClick={() => { unlockRadioAudio(); live.claimHere(sessionId) }}
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold">Use it here</button>
      </div>
    )
  }

  const { talking, theirTurn, elapsed, btWarning, route, onCall } = live
  const seconds = Math.floor(elapsed / 1000)
  const amber = elapsed >= AMBER_AT_MS
  const closesAt = live.channel?.expiresAt
    ? new Date(live.channel.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null
  const line = onCall ? 'Paused while you’re on a call — what they say waits and plays after.'
    : live.notice ?? notice ?? (closesAt ? `Closes at ${closesAt} unless someone talks` : ' ')

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
        onPointerDown={e => { e.preventDefault(); void live.press() }}
        onPointerUp={e => { e.preventDefault(); void live.release() }}
        onPointerCancel={() => { void live.release() }}
        onPointerLeave={() => { if (talking) void live.release() }}
        onContextMenu={e => e.preventDefault()}
        disabled={theirTurn || onCall}
        aria-label={theirTurn ? `${other.name} is talking` : 'Press and hold to talk'}
        className={`flex-1 min-h-0 w-full rounded-3xl flex flex-col items-center justify-center gap-3 select-none touch-none transition-colors
          ${theirTurn ? 'bg-emerald-700/80' : talking ? (amber ? 'bg-amber-600' : 'bg-red-600') : 'bg-gray-800'}`}
        style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
      >
        {theirTurn ? (
          <>
            <SpeakerIcon className="h-20 w-20" />
            <span className="text-xl font-semibold">{other.name} is talking</span>
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

      <p className="flex-none min-h-[1.25rem] text-center text-xs text-gray-400">{line}</p>
      <p className="flex-none text-center text-[11px] text-gray-500">
        You can leave this screen — the radio bar at the top keeps the channel with you anywhere in the Hub.
      </p>

      <button type="button" onClick={() => act('close')} disabled={busy}
        className="flex-none rounded-xl border border-gray-700 py-3 text-sm text-gray-300 disabled:opacity-50">
        Close channel
      </button>
    </div>
  )
}
