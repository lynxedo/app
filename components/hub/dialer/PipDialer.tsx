'use client'

// Session 3 (Desktop Dialer Control) — the floating Picture-in-Picture dialer.
//
// Rendered by DialerProvider via createPortal into the PiP window's document.body
// (see use-document-pip.ts). It is a PURE consumer of the shared call state from
// useDialerContext — it never creates a second Twilio Device and never owns the
// audio sink (that stays in the main document), so closing the PiP can't drop the
// call. Controls here read/write the exact same state as the GlobalCallBar and the
// /hub/dialer page.
//
// The window persists across calls (DialerProvider keeps it open until the user
// closes it), so once popped out it catches the NEXT incoming call too: when a
// call rings while the PiP is open, it shows Answer / Decline right in the
// floating window — the honest "answer from another app" win Ben asked for (we
// can't AUTO-open a PiP on an inbound call — Chromium requires a gesture — but we
// can update an already-open one).
//
// Three states: incoming (Answer/Decline) · active (controls + DTMF keypad) ·
// idle (ready, with Close).

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDialerContext } from './DialerProvider'

function formatPhone(raw: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

const KEYPAD: Array<{ d: string; sub?: string }> = [
  { d: '1' },
  { d: '2', sub: 'ABC' },
  { d: '3', sub: 'DEF' },
  { d: '4', sub: 'GHI' },
  { d: '5', sub: 'JKL' },
  { d: '6', sub: 'MNO' },
  { d: '7', sub: 'PQRS' },
  { d: '8', sub: 'TUV' },
  { d: '9', sub: 'WXYZ' },
  { d: '*' },
  { d: '0', sub: '+' },
  { d: '#' },
]

export default function PipDialer({
  pipWindow,
  onClose,
}: {
  pipWindow: Window
  onClose: () => void
}) {
  const device = useDialerContext()
  const [now, setNow] = useState(() => Date.now())
  const [showKeypad, setShowKeypad] = useState(false)

  const state = device?.state
  const inActiveCall = state === 'placing' || state === 'in-call'
  const incoming = state === 'incoming'

  // Tick for the live timer while a call is up.
  useEffect(() => {
    if (!inActiveCall) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [inActiveCall])

  // Reset the keypad each time a call ends.
  useEffect(() => {
    if (!inActiveCall) setShowKeypad(false)
  }, [inActiveCall])

  if (!device) return null

  const elapsed = device.callStartedAt ? now - device.callStartedAt : 0

  let body: ReactNode
  if (incoming) {
    // PiP was already open when a call arrived — surface Answer / Decline here.
    body = (
      <div className="flex flex-col items-center gap-5 py-6">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-wider text-sky-300 animate-pulse">
            Incoming call
          </div>
          <div className="mt-1 text-lg font-semibold text-white">
            {formatPhone(device.incomingFrom) || 'Unknown'}
          </div>
        </div>
        <div className="flex items-center gap-8">
          <button
            type="button"
            onClick={device.rejectIncoming}
            className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center"
            aria-label="Decline"
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 12 12)" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={device.acceptIncoming}
            className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 transition-all flex items-center justify-center animate-pulse"
            aria-label="Answer"
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
            </svg>
          </button>
        </div>
      </div>
    )
  } else if (inActiveCall) {
    const label =
      state === 'placing'
        ? `Dialing ${formatPhone(device.inCallWith)}…`
        : formatPhone(device.inCallWith) || 'On call'
    body = (
      <div className="flex flex-col gap-4">
        {/* Caller + timer */}
        <div className="text-center">
          <div className="text-base font-semibold text-white truncate">{label}</div>
          <div className="mt-0.5 text-sm font-mono text-white/70">
            {device.held ? 'On hold' : formatDuration(elapsed)}
          </div>
        </div>

        {/* Control row */}
        <div className="flex items-center justify-center gap-3">
          <RoundButton
            active={device.muted}
            onClick={device.toggleMute}
            label={device.muted ? 'Unmute' : 'Mute'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              {device.muted ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l4-4m0 4l-4-4" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              )}
            </svg>
          </RoundButton>

          {device.holdSupported && (
            <RoundButton
              active={device.held}
              onClick={device.toggleHold}
              label={device.held ? 'Resume' : 'Hold'}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                {device.held ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 013.15 0V15M6.9 7.575a1.575 1.575 0 10-3.15 0v8.175a6.75 6.75 0 006.75 6.75h2.018a5.25 5.25 0 003.712-1.538l1.732-1.732a5.25 5.25 0 001.538-3.712l.003-2.024a.668.668 0 01.198-.471 1.575 1.575 0 10-2.228-2.228 3.818 3.818 0 00-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0116.35 15m.002 0h-.002" />
                )}
              </svg>
            </RoundButton>
          )}

          <RoundButton
            active={showKeypad}
            onClick={() => setShowKeypad((v) => !v)}
            label={showKeypad ? 'Hide keypad' : 'Keypad'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01" />
            </svg>
          </RoundButton>

          <button
            type="button"
            onClick={device.hangup}
            className="w-11 h-11 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center"
            aria-label="End call"
          >
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 12 12)" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
            </svg>
          </button>
        </div>

        {/* DTMF keypad — sends tones into the live call (extensions / IVR menus) */}
        {showKeypad && (
          <div className="grid grid-cols-3 gap-2 mt-1">
            {KEYPAD.map((k) => (
              <button
                key={k.d}
                type="button"
                onClick={() => device.sendDigit(k.d)}
                className="flex flex-col items-center justify-center py-2 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white"
              >
                <span className="text-lg leading-none font-medium">{k.d}</span>
                {k.sub && <span className="text-[9px] tracking-widest text-white/50 mt-0.5">{k.sub}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  } else {
    // Idle — the window persists between calls so it can catch the next incoming.
    body = (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h3l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v3a2 2 0 01-2 2A14 14 0 014 6a2 2 0 012-2z" />
        </svg>
        <div className="text-sm text-white/60">No active call</div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
        >
          Close
        </button>
      </div>
    )
  }

  return createPortal(
    <div className="min-h-screen w-full bg-[#0b2236] text-white px-4 py-4 flex flex-col font-sans">
      {body}
    </div>,
    pipWindow.document.body
  )
}

function RoundButton({
  children,
  onClick,
  active,
  label,
}: {
  children: ReactNode
  onClick: () => void
  active: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
        active ? 'bg-white text-gray-900' : 'bg-white/15 text-white hover:bg-white/25'
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
