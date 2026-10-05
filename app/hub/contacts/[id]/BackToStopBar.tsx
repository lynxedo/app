'use client'

// The customer file opened from a Work Orders stop (…?woDate=&woStop=) shows a
// bar that goes straight back to that stop (Ben, Oct 5 2026: getting back to
// Work Orders from the customer file was not quick and easy). Reads
// window.location once — no Suspense boundary needed — and the irrigation
// deep-link cleanup keeps these two parameters.

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function BackToStopBar() {
  const [href, setHref] = useState<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const date = q.get('woDate')
    const stop = q.get('woStop')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (date && stop && /^\d{4}-\d{2}-\d{2}$/.test(date)) setHref(`/hub/daily-log-v2?date=${encodeURIComponent(date)}&stop=${encodeURIComponent(stop)}`)
  }, [])
  if (!href) return null
  return (
    <Link href={href}
      className="mb-2.5 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium">
      <span aria-hidden>‹</span> Back to the stop in Work Orders
    </Link>
  )
}
