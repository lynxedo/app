'use client'

// Desktop Dialer Control — Session 6. The 2-second after-call wrap-up prompt.
// Appears when a call ends; one tap logs the outcome onto the call row (surfaced
// in call-log2). Auto-dismisses if ignored so it never blocks the next action.

import { useEffect, useState } from 'react'

export default function CallDisposition({
  options,
  contactName,
  onDismiss,
}: {
  options: string[]
  contactName?: string | null
  onDismiss: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  // Auto-dismiss after 30s if the user ignores it.
  useEffect(() => {
    const id = setTimeout(onDismiss, 30000)
    return () => clearTimeout(id)
  }, [onDismiss])

  async function pick(disposition: string) {
    if (busy) return
    setBusy(true)
    setDone(disposition)
    try {
      await fetch('/api/dialer/calls/disposition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disposition }),
      })
    } catch {
      /* best-effort */
    }
    setTimeout(onDismiss, 700)
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[65] w-[min(92vw,30rem)]">
      <div className="rounded-xl bg-[var(--t-panel-deep)] text-white border border-white/15 shadow-2xl px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-white/60">
            Call ended{contactName ? ` · ${contactName}` : ''} — how did it go?
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-white/40 hover:text-white text-sm leading-none px-1"
            aria-label="Skip"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pick(opt)}
              disabled={busy}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-60 ${
                done === opt
                  ? 'bg-emerald-600 text-[#fff]'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
