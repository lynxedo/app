'use client'

// Block / unblock a caller from the Call Log detail — the screen you're on when
// you decide someone should stop calling.
//
// Blocking is confirmed first. It's cheap to undo but its symptom is silence:
// a wrongly-blocked customer just stops getting through, with nothing to
// notice. A confirm plus the reviewable list in Admin → Dialer is what keeps
// that recoverable.

import { useEffect, useState } from 'react'
import { formatPhone } from '@/lib/format'

export default function BlockCallerButton({ phone }: { phone: string | null }) {
  const [blocked, setBlocked] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const digits = (phone || '').replace(/\D/g, '').slice(-10)

  useEffect(() => {
    let cancelled = false
    if (digits.length < 10) {
      setBlocked(null)
      return
    }
    fetch('/api/dialer/blocked-numbers')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.blocked) return
        setBlocked(
          (d.blocked as { phone_digits: string }[]).some((b) => b.phone_digits === digits),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [digits])

  if (digits.length < 10 || blocked === null) return null

  async function toggle() {
    if (busy) return
    if (!blocked) {
      const ok = window.confirm(
        `Block ${formatPhone(phone) || phone}?\n\n` +
          'Their calls will get a busy signal and their texts will be dropped. ' +
          'Nobody will be notified that they tried. You can unblock them any time in ' +
          'Admin → Dialer → Blocked callers.',
      )
      if (!ok) return
    }
    setBusy(true)
    try {
      const res = blocked
        ? await fetch(`/api/dialer/blocked-numbers?phone=${encodeURIComponent(digits)}`, {
            method: 'DELETE',
          })
        : await fetch('/api/dialer/blocked-numbers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone }),
          })
      if (res.ok) setBlocked(!blocked)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={blocked ? 'Let this number through again' : 'Refuse calls and texts from this number'}
      className={`shrink-0 text-xs px-2.5 py-1 rounded-md whitespace-nowrap disabled:opacity-50 ${
        blocked
          ? 'bg-red-600/20 text-red-300 hover:bg-red-600/30'
          : 'bg-white/10 text-gray-200 hover:bg-white/20'
      }`}
    >
      {busy ? '…' : blocked ? '⊘ Blocked — unblock' : '⊘ Block'}
    </button>
  )
}
