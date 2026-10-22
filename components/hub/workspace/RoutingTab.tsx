'use client'

/**
 * Workspace-tab twin for the Route Optimizer (`/hub/routing`). The real page
 * works out "is Jobber connected / may this person reconnect it" on the server;
 * a kept-alive tab has no server page, so this asks /api/hub/routing/status and
 * then renders the very same RoutingScreen the page renders (Ben, Oct 22 2026 —
 * "the route optimizer should be able to be a tab").
 */

import { useEffect, useState } from 'react'
import RoutingScreen from '@/app/hub/routing/RoutingScreen'

export default function RoutingTab() {
  const [status, setStatus] = useState<{ jobberConnected: boolean; canConnectJobber: boolean } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/hub/routing/status')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (alive) setStatus({ jobberConnected: !!d.jobberConnected, canConnectJobber: !!d.canConnectJobber }) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  if (failed) return <div className="flex-1 p-6 text-sm text-red-400">Couldn&apos;t load Routing. Close this tab and open it again.</div>
  if (!status) return <div className="flex-1 p-6 text-sm text-gray-400">Loading Routing…</div>
  return <RoutingScreen jobberConnected={status.jobberConnected} canConnectJobber={status.canConnectJobber} />
}
