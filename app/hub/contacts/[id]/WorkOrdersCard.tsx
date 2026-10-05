'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Work Orders Phase 1 — the customer file's list of work orders (Daily Log v2
// stops) done at this customer, newest day first. Rule 7 of the PRD: every stop
// links to the customer file, and every report links back to its stop — this is
// the "customer file → stops" direction. "Open the day" lands on the Work Order
// list for that date with the stop expanded; "Inspection" opens the saved
// irrigation report in the Irrigation card on this same page.

type WorkOrder = {
  id: string
  date: string
  tech: string | null
  status: string
  skipReason: string | null
  jobTitle: string | null
  services: string[]
  arrivedAt: string | null
  completedAt: string | null
  inspection: { id: string; status: 'draft' | 'final' } | null
  serviceReport?: { id: string; status: 'draft' | 'final' } | null
}

function fmtDate(d: string): string {
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d)
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusChip({ wo }: { wo: WorkOrder }) {
  if (wo.status === 'complete') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">✓ Complete</span>
  if (wo.status === 'in_progress') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">In progress</span>
  if (wo.status === 'skipped') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">⊘ {wo.skipReason || 'Skipped'}</span>
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">Scheduled</span>
}

export default function WorkOrdersCard({ contactId }: { contactId: string }) {
  const [items, setItems] = useState<WorkOrder[] | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/hub/contacts/${contactId}/work-orders`)
      .then(r => (r.ok ? r.json() : { workOrders: [] }))
      .then(j => { if (!cancelled) setItems(Array.isArray(j.workOrders) ? j.workOrders : []) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [contactId])

  function openInspection(id: string) {
    // The Irrigation card on this page listens for this and opens the report in
    // place (no reload, no second fetch of the customer).
    window.dispatchEvent(new CustomEvent('lx:open-inspection', { detail: { id } }))
    document.getElementById('irrigation-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function openServiceReport(id: string) {
    // The After-service reports card on this page opens it in place.
    window.dispatchEvent(new CustomEvent('lx:open-service-report', { detail: { id } }))
    setTimeout(() => document.getElementById('service-report-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
  }

  const shown = items ? (showAll ? items : items.slice(0, 5)) : []

  return (
    <section className="bg-[var(--t-panel)] border border-white/10 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-medium text-white/70">Work orders</h2>
        {items && items.length > 0 && (
          <span className="text-[11px] text-white/40">{items.length} visit{items.length === 1 ? '' : 's'}</span>
        )}
      </div>

      {!items ? (
        <div className="text-xs text-white/40">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-white/40">
          No work orders yet. They appear here when the office sends a route that includes this customer to the Work Order list.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-white/5">
          {shown.map(wo => (
            <div key={wo.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-white/85">{fmtDate(wo.date)}</span>
                  {wo.tech && <span className="text-[11px] text-white/40">· {wo.tech}</span>}
                  <StatusChip wo={wo} />
                </div>
                <div className="flex items-center gap-2">
                  {wo.inspection && (
                    <button
                      type="button"
                      onClick={() => openInspection(wo.inspection!.id)}
                      className="text-[11px] px-2 py-1 rounded bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-200"
                    >
                      💧 {wo.inspection.status === 'final' ? 'Inspection' : 'Inspection (draft)'}
                    </button>
                  )}
                  {wo.serviceReport && (
                    <button
                      type="button"
                      onClick={() => openServiceReport(wo.serviceReport!.id)}
                      className="text-[11px] px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200"
                    >
                      📋 {wo.serviceReport.status === 'final' ? 'Report' : 'Report (draft)'}
                    </button>
                  )}
                  <Link
                    href={`/hub/daily-log-v2?date=${encodeURIComponent(wo.date)}&stop=${encodeURIComponent(wo.id)}`}
                    className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/70"
                  >
                    Open the day →
                  </Link>
                </div>
              </div>
              {(wo.jobTitle || wo.services.length > 0) && (
                <div className="text-[12px] text-white/45 mt-0.5 truncate">
                  {wo.jobTitle}
                  {wo.jobTitle && wo.services.length > 0 ? ' · ' : ''}
                  {wo.services.slice(0, 2).join(' · ')}
                  {wo.services.length > 2 ? ` +${wo.services.length - 2} more` : ''}
                </div>
              )}
            </div>
          ))}
          {items.length > 5 && (
            <button type="button" onClick={() => setShowAll(v => !v)} className="pt-2 text-left text-xs text-sky-300 hover:text-sky-200">
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
