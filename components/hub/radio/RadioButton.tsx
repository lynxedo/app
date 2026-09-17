'use client'

// The Radio control in a 1-on-1 DM header. Opening a channel is idempotent server-side,
// so a double tap lands you in the one channel rather than opening two.
//
// ⚠ `onCall` is a COURTESY block, not enforcement. On-call state is ephemeral Realtime
// presence with no server-side row, so the API cannot verify it and a stale or missing
// presence will let one through. That is fine: the worst case is an invite they decline.
// It stays greyed-but-tappable on purpose — a button that vanishes teaches people the
// feature is broken, and a `disabled` button gives a thumb no feedback at all, so the
// tap has to be what explains itself.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { RadioIcon } from './RadioIcons'

export default function RadioButton({ conversationId, onCall = false }: { conversationId: string; onCall?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function open() {
    if (busy) return
    if (onCall) { toast.error('They’re on a phone call right now — try again in a minute.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/hub/radio/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Could not open a radio channel'); return }
      router.push(`/hub/radio/${body.session.id}`)
    } catch {
      toast.error('No connection — could not open a radio channel')
    } finally { setBusy(false) }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      aria-disabled={onCall || undefined}
      title={onCall ? 'They’re on a phone call right now' : 'Radio — press and hold to talk'}
      aria-label={onCall ? 'Radio unavailable — they are on a phone call' : 'Open a radio channel'}
      className={
        'p-1.5 rounded-lg disabled:opacity-50 ' +
        (onCall
          ? 'text-gray-600 cursor-not-allowed'
          : 'text-gray-400 hover:text-white hover:bg-gray-800')
      }
    >
      <RadioIcon className="h-4 w-4" />
    </button>
  )
}
