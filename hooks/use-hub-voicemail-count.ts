'use client'

// Hub-wide poll of the user's unheard voicemail count. Drives the red badge
// on the rail Dialer icon so a missed-call voicemail shows up even when the
// Dialer sidebar isn't open.
//
// Polls /api/dialer/voicemails?scope=unheard&limit=1 every 30s (the route
// returns the full `unheard_count` regardless of limit so a 1-row fetch is
// enough). Pauses when the document is hidden — no point burning cycles
// against the server when the tab is in the background.

import { useEffect, useState } from 'react'

export function useHubVoicemailCount(enabled: boolean): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    async function tick() {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const res = await fetch('/api/dialer/voicemails?scope=unheard&limit=1', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json()
        if (cancelled) return
        const n = Number(body?.unheard_count ?? 0)
        setCount(Number.isFinite(n) && n > 0 ? n : 0)
      } catch {
        // Network blip — keep last known count. Next tick will reconcile.
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

  return count
}
