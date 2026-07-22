'use client'

import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // check every 5 minutes
const INITIAL_DELAY_MS  = 60 * 1000     // first check 60s after page load

export function UpdateNotifier({ loadedBuildId }: { loadedBuildId: string }) {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if (!loadedBuildId || loadedBuildId === 'unknown') return

    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { buildId } = await res.json()
        if (buildId && buildId !== loadedBuildId) setUpdateAvailable(true)
      } catch {
        // network error — ignore, will retry on next interval
      }
    }

    const initial = setTimeout(check, INITIAL_DELAY_MS)
    const interval = setInterval(check, POLL_INTERVAL_MS)
    return () => { clearTimeout(initial); clearInterval(interval) }
  }, [loadedBuildId])

  if (!updateAvailable) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-blue-600 px-5 py-3 shadow-lg text-sm font-medium text-[#fff]">
      <span>A new version is available</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50"
      >
        Refresh
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        className="opacity-70 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
