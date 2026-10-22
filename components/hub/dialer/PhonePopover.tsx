'use client'

// The pop-up phone (desktop): the rail's Dialer and every click-to-call open
// this small dial pad over whatever you're doing, with the number filled in —
// you press Call and stay on your screen. It uses the shell's one phone (the
// DialerProvider's Device); the live call then rides the call bar on every tab.
// "Open full Dialer" goes to the Dialer itself (history, voicemail, transfers).

import { useEffect } from 'react'
import { useDialerContext } from './DialerProvider'
import Dialpad from './Dialpad'

export default function PhonePopover({
  open,
  number,
  conversationId,
  contactId,
  nonce,
  onClose,
  onOpenDialer,
}: {
  open: boolean
  number: string
  conversationId: string | null
  contactId: string | null
  /** Bumps on every open so the pad re-reads `number`. */
  nonce: number
  onClose: () => void
  onOpenDialer: () => void
}) {
  const device = useDialerContext()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !device) return null

  const busy = device.state === 'placing' || device.state === 'in-call' || device.state === 'incoming'
  const ready = device.state === 'ready' || device.state === 'ended'
  const status =
    busy ? 'You’re on a call — it’s in the bar at the top.'
    : device.state === 'connecting' || device.state === 'idle' ? 'Connecting the phone…'
    : device.state === 'error' ? (device.errorMessage || 'The phone isn’t connected.')
    : device.state === 'not-configured' ? 'Calling isn’t set up for this company.'
    : null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed z-50 left-[76px] top-24 w-[300px] rounded-2xl border border-white/10 bg-gray-900 shadow-2xl p-4"
        role="dialog"
        aria-label="Phone"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-white">Phone</span>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white p-1 rounded" aria-label="Close">✕</button>
        </div>
        <Dialpad
          key={nonce}
          initialValue={number}
          disabled={!ready}
          onCall={n => {
            void device.placeCall(n, { conversationId, contactId })
            onClose()
          }}
        />
        {status && <p className="mt-3 text-center text-[12px] text-white/50">{status}</p>}
        <button
          type="button"
          onClick={onOpenDialer}
          className="mt-3 w-full h-9 rounded-lg border border-white/10 text-[13px] font-medium text-white/75 hover:text-white hover:bg-white/[0.06]"
        >
          Open full Dialer
        </button>
      </div>
    </>
  )
}
