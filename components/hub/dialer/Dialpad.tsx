'use client'

import { useState } from 'react'

const KEYS: Array<{ digit: string; letters?: string }> = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*' },
  { digit: '0', letters: '+' },
  { digit: '#' },
]

function formatPhone(raw: string): string {
  // Visual only — doesn't change the stored value
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 0) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  return digits.slice(0, 11)
}

export default function Dialpad({
  onCall,
  disabled,
  initialValue,
}: {
  onCall: (number: string) => void
  disabled?: boolean
  initialValue?: string
}) {
  const [value, setValue] = useState(initialValue ?? '')

  function appendKey(k: string) {
    if (disabled) return
    // Long-press of '0' inserts '+', but keep simple for v1 — '+' lives on its
    // own via the keyboard input.
    setValue((prev) => (prev + k).slice(0, 15))
  }
  function backspace() {
    setValue((prev) => prev.slice(0, -1))
  }
  function call() {
    const cleaned = value.replace(/[^\d+]/g, '')
    if (!cleaned) return
    onCall(cleaned)
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    if (e.key === 'Backspace') {
      backspace()
      e.preventDefault()
    } else if (e.key === 'Enter') {
      call()
      e.preventDefault()
    } else if (/^[0-9*#+]$/.test(e.key)) {
      appendKey(e.key)
      e.preventDefault()
    }
  }

  return (
    <div
      // Fluid on phones: fills ~82% of the screen width up to a 340px cap, so a
      // big phone gets a noticeably larger pad than a small one (instead of
      // every phone being locked to the same fixed width). Desktop stays capped.
      className="w-full max-w-[min(82vw,340px)] md:max-w-xs mx-auto select-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="mb-2 md:mb-4 text-center min-h-[2rem] md:min-h-[2.5rem]">
        <input
          type="tel"
          value={formatPhone(value)}
          onChange={(e) => setValue(e.target.value.replace(/[^\d+]/g, ''))}
          placeholder="Enter number…"
          inputMode="tel"
          className="w-full bg-transparent text-center text-2xl md:text-3xl font-light tracking-wider text-white placeholder-white/30 outline-none"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-3 md:mb-5">
        {KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            onClick={() => appendKey(k.digit)}
            disabled={disabled}
            className="aspect-square rounded-full bg-white/5 hover:bg-white/10 active:bg-white/20 transition-colors flex flex-col items-center justify-center disabled:opacity-40"
          >
            <span className="text-2xl font-light text-white">{k.digit}</span>
            {k.letters && (
              <span className="text-[9px] md:text-[10px] tracking-widest text-white/40 mt-0.5">
                {k.letters}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-center gap-4 md:gap-6">
        <div className="w-10 h-10 md:w-12 md:h-12" />
        <button
          type="button"
          onClick={call}
          disabled={disabled || !value}
          className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/5 disabled:text-white/30 active:scale-95 transition-all flex items-center justify-center shadow-lg"
          aria-label="Call"
        >
          <svg className="w-6 h-6 md:w-7 md:h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={backspace}
          disabled={!value}
          className="w-10 h-10 md:w-12 md:h-12 rounded-full hover:bg-white/10 disabled:opacity-30 flex items-center justify-center text-white/60"
          aria-label="Delete"
        >
          <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l4-4h13a2 2 0 012 2v4a2 2 0 01-2 2H7l-4-4zm10-2l4 4m0-4l-4 4" />
          </svg>
        </button>
      </div>
    </div>
  )
}
