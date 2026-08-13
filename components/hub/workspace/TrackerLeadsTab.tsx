'use client'

/**
 * Workspace-tab twin for the Lead Tracker (`/hub/tracker/leads`). The real
 * screen's server page supplies settings/stages/columns as props; a kept-alive
 * tab has no server page, so this twin fetches those three from their existing
 * GET routes, then renders the actual TrackerPage. Leads self-fetch
 * (initialLeads=null) and the column layout falls back to the default
 * (initialColumnLayout=null — there is no client GET for the saved layout yet;
 * a small follow-up could add one).
 */

import { useEffect, useState, type ComponentProps } from 'react'
import TrackerPage, { type CurrentUser } from '@/app/hub/tracker/TrackerPage'

type TrackerProps = ComponentProps<typeof TrackerPage>

export default function TrackerLeadsTab({
  currentUser,
  canCall,
  canText,
}: {
  currentUser: CurrentUser
  // Passed down rather than re-derived: HubShell already holds these, and a twin
  // that resolved permissions its own way would be free to drift from the real
  // screen — which is precisely how a twin ends up silently missing a feature.
  canCall: boolean
  canText: boolean
}) {
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<TrackerProps['settings']>(null)
  const [stages, setStages] = useState<TrackerProps['stages']>([])
  const [columns, setColumns] = useState<TrackerProps['customColumnDefs']>([])

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch('/api/tracker/settings').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/tracker/stages').then(r => (r.ok ? r.json() : [])).catch(() => []),
      fetch('/api/tracker/columns').then(r => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([s, st, c]) => {
      if (!alive) return
      setSettings(s ?? null)
      setStages(Array.isArray(st) ? st : [])
      setColumns(Array.isArray(c) ? c : [])
      setReady(true)
    })
    return () => { alive = false }
  }, [])

  if (!ready) return <div className="flex-1 min-h-0 p-6 text-sm text-white/50">Loading Lead Tracker…</div>

  return (
    <TrackerPage
      settings={settings}
      currentUser={currentUser}
      stages={stages}
      customColumnDefs={columns}
      initialLeads={null}
      initialColumnLayout={null}
      canCall={canCall}
      canText={canText}
    />
  )
}
