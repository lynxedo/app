'use client'

import { useEffect, useState } from 'react'

const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

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

export default function ActiveCall({
  status,
  who,
  startedAt,
  muted,
  onToggleMute,
  onSendDigit,
  onHangup,
}: {
  status: 'placing' | 'in-call'
  who: string | null
  startedAt: number | null
  muted: boolean
  onToggleMute: () => void
  onSendDigit: (d: string) => void
  onHangup: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const [showKeypad, setShowKeypad] = useState(false)

  useEffect(() => {
    if (status !== 'in-call') return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [status])

  const elapsed = startedAt && status === 'in-call' ? Math.floor((now - startedAt) / 1000) : 0

  return (
    <div className="w-full max-w-xs mx-auto text-center">
      <div className="text-white/50 text-sm mb-2">
        {status === 'placing' ? 'Calling…' : 'On call'}
      </div>
      <div className="text-2xl font-light text-white mb-1">{formatPhone(who)}</div>
      <div className="text-white/50 text-sm mb-8">
        {status === 'in-call' ? formatTimer(elapsed) : '—'}
      </div>

      {showKeypad ? (
        <div className="grid grid-cols-3 gap-3 mb-5 max-w-xs mx-auto">
          {DTMF_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onSendDigit(k)}
              className="aspect-square rounded-full bg-white/5 hover:bg-white/10 active:bg-white/20 text-xl font-light text-white"
            >
              {k}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-5 max-w-xs mx-auto">
          <button
            type="button"
            onClick={onToggleMute}
            className={`aspect-square rounded-full flex flex-col items-center justify-center text-xs ${
              muted
                ? 'bg-white text-gray-900'
                : 'bg-white/5 text-white hover:bg-white/10'
            }`}
            aria-label="Mute"
          >
            <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              {muted ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l4-4m0 4l-4-4" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M19.07 4.929a10 10 0 010 14.142M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              )}
            </svg>
            <span>{muted ? 'Muted' : 'Mute'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowKeypad(true)}
            disabled={status !== 'in-call'}
            className="aspect-square rounded-full bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center text-xs text-white disabled:opacity-40"
            aria-label="Keypad"
          >
            <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h.01M5 12h.01M5 17h.01M12 7h.01M12 12h.01M12 17h.01M19 7h.01M19 12h.01M19 17h.01" />
            </svg>
            <span>Keypad</span>
          </button>
          <div />
        </div>
      )}

      {showKeypad && (
        <button
          type="button"
          onClick={() => setShowKeypad(false)}
          className="text-white/50 hover:text-white text-xs mb-4"
        >
          Hide keypad
        </button>
      )}

      <button
        type="button"
        onClick={onHangup}
        className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center shadow-lg mx-auto"
        aria-label="Hang up"
      >
        <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 12 12)" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
        </svg>
      </button>
    </div>
  )
}
