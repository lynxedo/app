'use client'

import { useEffect, useState } from 'react'

// SB-retry — shared loader for the scoreboard views. Each board fetches the
// same `/api/hub/scoreboards?board=<slug>` endpoint with identical error/retry
// behavior; this hook is the single source so the four views can't drift.
// `reload()` re-runs the fetch (wired to the "Try again" button on failure).
export function useScoreboardData<T>(slug: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    setData(null)
    fetch(`/api/hub/scoreboards?board=${slug}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (alive) setData(d as T) })
      .catch(e => { if (alive) setError(String(e.message || e)) })
    return () => { alive = false }
  }, [slug, reloadKey])

  return { data, error, reload: () => setReloadKey(k => k + 1) }
}
