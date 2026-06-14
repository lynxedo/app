'use client'

// Session 58.5 — thin top-of-Hub banner shown when a call is in progress AND
// the user has navigated away from /hub/dialer. Tap returns to /hub/dialer;
// × dismisses for the lifetime of this call (resets on the next call).

import { useEffect, useState } from 'react'
import { formatPhone } from '@/lib/format'
import { usePathname, useRouter } from 'next/navigation'
import { useDialerContext } from './DialerProvider'


function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export default function ActiveCallBanner() {
  const device = useDialerContext()
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  // Tick once a second so the call timer updates while the banner is mounted.
  useEffect(() => {
    if (!device) return
    const inActiveCall = device.state === 'placing' || device.state === 'in-call'
    if (!inActiveCall) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [device, device?.state])

  if (!device) return null

  const inActiveCall = device.state === 'placing' || device.state === 'in-call'
  const onDialerPage = pathname === '/hub/dialer' || pathname.startsWith('/hub/dialer/')

  // Identify "this call" by the start instant + counterparty so a dismiss
  // doesn't bleed into the next call.
  const callKey = inActiveCall
    ? `${device.callStartedAt ?? 'placing'}:${device.inCallWith ?? ''}`
    : null

  if (!inActiveCall) return null
  if (onDialerPage) return null
  if (callKey && dismissedKey === callKey) return null

  const elapsed = device.callStartedAt ? now - device.callStartedAt : 0
  const label = device.state === 'placing'
    ? `Dialing ${formatPhone(device.inCallWith)}…`
    : `On call with ${formatPhone(device.inCallWith) || 'caller'} · ${formatDuration(elapsed)}`

  return (
    <button
      type="button"
      onClick={() => router.push('/hub/dialer')}
      className="w-full flex items-center justify-between gap-3 px-4 py-2 bg-emerald-700/90 hover:bg-emerald-700 text-white text-sm font-medium border-b border-emerald-900/40"
      aria-label="Return to active call"
    >
      <span className="flex items-center gap-2 min-w-0">
        <svg className="w-4 h-4 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h3l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v3a2 2 0 01-2 2A14 14 0 014 6a2 2 0 012-2z" />
        </svg>
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-2 flex-none">
        <span className="hidden sm:inline text-xs text-white/80">Tap to return</span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss banner"
          onClick={(e) => { e.stopPropagation(); if (callKey) setDismissedKey(callKey) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              if (callKey) setDismissedKey(callKey)
            }
          }}
          className="w-6 h-6 rounded hover:bg-white/15 flex items-center justify-center cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      </span>
    </button>
  )
}
