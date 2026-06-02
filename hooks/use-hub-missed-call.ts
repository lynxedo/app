'use client'

// Hub-wide poll of the user's most recent missed inbound call timestamp. Drives
// the orange "missed call" dot on the rail Dialer icon so a missed call shows up
// from any Hub page, even when the Dialer sidebar isn't open.
//
// Polls /api/dialer/calls?scope=missed&limit=1 (newest first) every 30s and
// returns the latest missed call's created_at. HubShell compares it to a
// per-device "last opened Dialer" timestamp to decide whether the dot is lit —
// so it clears when you visit the Dialer and relights on the next missed call.
// Pauses while the tab is hidden (mirrors use-hub-voicemail-count).

import { useEffect, useState } from 'react'

export function useHubMissedCall(enabled: boolean): string | null {
  const [latestAt, setLatestAt] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLatestAt(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    async function tick() {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const res = await fetch('/api/dialer/calls?scope=missed&limit=1', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json()
        if (cancelled) return
        const rows = Array.isArray(body?.calls) ? body.calls : []
        setLatestAt(rows[0]?.created_at ?? null)
      } catch {
        // Network blip — keep last known value. Next tick reconciles.
      }
    }

    function start() {
      tick()
      timer = setInterval(tick, 30_000)
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null }
    }
    function onVisibility() {
      if (document.hidden) stop()
      else { stop(); start() } // tick immediately on becoming visible
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])

  return latestAt
}
