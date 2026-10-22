'use client'

// The radio bar: a slim strip across the top of every Hub page while a channel is
// open, so you can keep talking while you work anywhere else in the Hub. Hold the
// button to talk; their words play wherever you are; tap the name for the full
// Radio screen. Hidden on that screen itself, which is the same channel, bigger.
//
// It floats above the full-screen Work Order views (stop, inspection, report), since
// those are exactly where a technician will be mid-conversation. Its height is
// published as --radio-bar-h, with html[data-radio-bar] set while it shows; the
// shell and those full-screen views read it (globals.css) so nothing sits under it.
// Incoming calls, the photo viewer and a few other takeovers sit above it on purpose.
//
// The engine is RadioProvider; this file only draws it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useOnScreenPath } from '../workspace/WorkspaceTabsContext'
import { useRadio, type RadioApi, type RadioChannel } from './RadioProvider'
import { useDialerContext } from '../dialer/DialerProvider'
import { MicIcon, RadioIcon } from './RadioIcons'
import { unlockRadioAudio } from '@/lib/radio/playQueue'

const AMBER_AT_MS = 45_000

export default function RadioBar() {
  const radio = useRadio()
  const pathname = useOnScreenPath()
  const router = useRouter()
  const barRef = useRef<HTMLDivElement>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)

  const ch = radio?.channel ?? null
  const show = !!ch && !pathname.startsWith(`/hub/radio/${ch.sessionId}`)

  // Tell the page how tall the bar is, so the shell and the full-screen views start
  // below it. Removed the moment the bar goes, so a closed channel leaves no gap.
  useLayoutEffect(() => {
    const root = document.documentElement
    const el = barRef.current
    if (!show || !el) return
    const apply = () => root.style.setProperty('--radio-bar-h', `${el.offsetHeight}px`)
    apply()
    root.setAttribute('data-radio-bar', '')
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.removeAttribute('data-radio-bar')
      root.style.removeProperty('--radio-bar-h')
    }
  }, [show])

  // "End?" reverts by itself — a glove brushing ✕ once must never close a channel.
  useEffect(() => {
    if (!confirmEnd) return
    const t = setTimeout(() => setConfirmEnd(false), 3000)
    return () => clearTimeout(t)
  }, [confirmEnd])

  if (!radio) return null
  return (
    <>
      <DialerCallWatcher setOnCall={radio.setOnCall} />
      {/* Portalled to <body>: the glass themes blur .hub-main, and a fixed element
          inside a blurred one is pinned to that element, not to the screen. */}
      {show && ch && createPortal(
        <div
          ref={barRef}
          role="region"
          aria-label={`Radio with ${ch.other.name}`}
          className={`fixed inset-x-0 top-0 z-[55] border-b text-white shadow-lg shadow-black/30 transition-colors ${barTone(radio)}`}
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex items-center gap-2 px-3 py-1.5">
            <button
              type="button"
              onClick={() => router.push(`/hub/radio/${ch.sessionId}`)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              aria-label={`Open the radio screen for ${ch.other.name}`}
            >
              <RadioIcon className={`h-5 w-5 flex-none ${radio.here && !radio.onCall && !radio.talking && !radio.theirTurn ? 'text-blue-400' : 'text-white/80'}`} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold leading-tight">{ch.other.name}</span>
                <span className="block truncate text-[11px] leading-tight text-white/75">{statusLine(radio, ch)}</span>
              </span>
            </button>

            {radio.here ? (
              <button
                type="button"
                onPointerDown={e => { e.preventDefault(); void radio.press() }}
                onPointerUp={e => { e.preventDefault(); void radio.release() }}
                onPointerCancel={() => { void radio.release() }}
                onPointerLeave={() => { if (radio.talking) void radio.release() }}
                onContextMenu={e => e.preventDefault()}
                disabled={radio.theirTurn || radio.onCall}
                aria-label={radio.theirTurn ? `${ch.other.name} is talking` : 'Press and hold to talk'}
                className={`flex h-11 min-w-[8.5rem] flex-none select-none touch-none items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-60
                  ${radio.talking ? 'bg-white/20' : radio.theirTurn ? 'bg-white/10' : 'bg-blue-600 active:bg-blue-500'}`}
                style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
              >
                <MicIcon className="h-4 w-4" />
                {radio.talking ? <span className="tabular-nums">{Math.floor(radio.elapsed / 1000)}s</span>
                  : radio.theirTurn ? 'Listening'
                  : 'Hold to talk'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { unlockRadioAudio(); radio.claimHere(ch.sessionId) }}
                className="h-11 flex-none rounded-full border border-white/20 px-4 text-sm font-semibold hover:bg-white/10"
              >
                Use here
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (!confirmEnd) { setConfirmEnd(true); return }
                setConfirmEnd(false)
                void radio.close()
              }}
              aria-label={confirmEnd ? 'Tap again to close the channel' : 'Close the radio channel'}
              className={`flex h-11 flex-none items-center justify-center rounded-full text-sm font-semibold transition-colors
                ${confirmEnd ? 'bg-red-600 px-3' : 'w-9 text-white/60 hover:text-white'}`}
            >
              {confirmEnd ? 'End?' : '✕'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function statusLine(r: RadioApi, ch: RadioChannel): string {
  const closesAt = ch.expiresAt
    ? new Date(ch.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null
  if (r.elsewhere === 'device') return 'Playing on your other device'
  if (r.elsewhere === 'tab') return 'Playing in another tab'
  if (r.onCall) return 'Paused while you’re on a call'
  if (r.notice) return r.notice
  if (r.theirTurn) return `${ch.other.name} is talking`
  if (r.talking) return r.elapsed >= AMBER_AT_MS ? 'Nearly at the 60-second limit' : 'Let go to send'
  if (r.btWarning) return '⚠ Bluetooth headset — tap for details'
  return closesAt ? `Closes at ${closesAt} if nobody talks` : 'Radio open'
}

function barTone(r: RadioApi): string {
  if (!r.here || r.onCall) return 'bg-gray-900 border-gray-700'
  if (r.theirTurn) return 'bg-emerald-700 border-emerald-900/50'
  if (r.talking) return r.elapsed >= AMBER_AT_MS ? 'bg-amber-600 border-amber-800/50' : 'bg-red-600 border-red-800/50'
  return 'bg-gray-900 border-gray-700'
}

/** A Dialer call has the speaker and the mic; the radio holds until it's over. */
function DialerCallWatcher({ setOnCall }: { setOnCall: (onCall: boolean) => void }) {
  const device = useDialerContext()
  const onCall = !!device && (device.state === 'placing' || device.state === 'in-call')
  useEffect(() => { setOnCall(onCall) }, [onCall, setOnCall])
  useEffect(() => () => setOnCall(false), [setOnCall])
  return null
}
