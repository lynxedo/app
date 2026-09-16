'use client'

// The Radio control in a 1-on-1 DM header. Opening a channel is idempotent server-side,
// so a double tap lands you in the one channel rather than opening two.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { RadioIcon } from './RadioIcons'

export default function RadioButton({ conversationId }: { conversationId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function open() {
    if (busy) return
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
      title="Radio — press and hold to talk"
      aria-label="Open a radio channel"
      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-50"
    >
      <RadioIcon className="h-4 w-4" />
    </button>
  )
}
