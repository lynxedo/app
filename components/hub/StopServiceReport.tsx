'use client'

// Work Orders Phase 3 — the after-service report opened ON TOP of the stop, the
// same way the irrigation inspection is (StopInspection). Same form and API as
// the customer file's After-service reports card; closing or saving lands back
// on the stop.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import AfterServiceForm, { type FullReport } from '@/app/hub/contacts/[id]/AfterServiceForm'
import { ReportReadView } from '@/app/hub/contacts/[id]/AfterServiceSection'
import SendReportPanel, { type ReportContact } from '@/app/hub/contacts/[id]/SendReportPanel'

export default function StopServiceReport({ contactId, stopId, reportId, mode, customerHref, onClose }: {
  contactId: string
  stopId: string
  /** The saved report to show; omit to start or resume this stop's draft. */
  reportId?: string | null
  mode: 'edit' | 'view'
  customerHref: string
  /** `changed` = the draft was saved or reopened — refresh the stop. */
  onClose: (changed: boolean) => void
}) {
  const [form, setForm] = useState<FullReport | null>(null)
  const [view, setView] = useState<FullReport | null>(null)
  const [contact, setContact] = useState<ReportContact | null>(null)
  const [changed, setChanged] = useState(false)
  // Shown right after Save: the report is saved — now send it.
  const [justSaved, setJustSaved] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reopened, setReopened] = useState(false)

  const loadOne = useCallback(async (id: string) => {
    const res = await fetch(`/api/hub/contacts/${contactId}/service-reports?reportId=${encodeURIComponent(id)}`)
    const j = await res.json()
    if (!res.ok || !j.report) throw new Error(j.error || 'Could not open the report')
    return j as { report: FullReport; canEdit: boolean; contact: ReportContact | null }
  }, [contactId])

  useEffect(() => {
    let cancelled = false
    async function go() {
      try {
        if (mode === 'view' && reportId) {
          const j = await loadOne(reportId)
          if (!cancelled) { setView(j.report); setCanEdit(!!j.canEdit); setContact(j.contact) }
          return
        }
        // Start the report for this stop's visit, or resume the one already there.
        const res = await fetch(`/api/hub/contacts/${contactId}/service-reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stopId }),
        })
        const j = await res.json()
        if (!res.ok || !j.report) throw new Error(j.error || 'Could not start the report')
        if (cancelled) return
        if (j.report.status === 'draft') setForm(j.report)
        else {
          const one = await loadOne(j.report.id)
          if (!cancelled) { setView(one.report); setCanEdit(!!one.canEdit); setContact(one.contact) }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open the report')
      }
    }
    void go()
    return () => { cancelled = true }
  }, [contactId, stopId, reportId, mode, loadOne])

  async function reopen() {
    if (!view || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/service-reports/${view.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || 'Could not reopen the report'); return }
      const again = await fetch(`/api/hub/contacts/${contactId}/service-reports?reportId=${encodeURIComponent(view.id)}`)
      const r = await again.json()
      if (r.report) { setReopened(true); setView(null); setForm(r.report) }
    } finally { setBusy(false) }
  }

  if (form) {
    return (
      <AfterServiceForm
        contactId={contactId}
        report={form}
        onClose={() => onClose(true)}
        onSaved={() => {
          // Saved — stay here on the read view so the tech can send it.
          const id = form.id
          setForm(null); setChanged(true); setJustSaved(true)
          loadOne(id)
            .then(j => { setView(j.report); setCanEdit(!!j.canEdit); setContact(j.contact) })
            .catch(e => setError(e instanceof Error ? e.message : 'Could not open the report'))
        }}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-[var(--t-panel-deep)] text-white flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] border-b border-white/10">
        <button type="button" onClick={() => onClose(reopened || changed)} className="text-sm text-white/70 hover:text-white">‹ Back to stop</button>
        <div className="flex-1 text-sm font-medium text-white/80">After-service report</div>
        <Link href={customerHref} className="text-xs text-sky-300 hover:text-sky-200">Customer file ›</Link>
      </div>
      <div className="flex-1 overflow-y-auto p-4 max-w-2xl w-full mx-auto">
        {error && <div className="mb-3 bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}
        {!error && !view && <div className="text-sm text-white/40">Loading…</div>}
        {view && (
          <>
            {justSaved && <div className="mb-3 text-sm text-emerald-300">✓ Report saved. Send it to the customer below.</div>}
            {canEdit && view.status === 'final' && (
              <div className="mb-4">
                <SendReportPanel contactId={contactId} report={view} contact={contact}
                  onSent={r => { setChanged(true); setView(v => v ? { ...v, sentAt: new Date().toISOString(), sentVia: r.sentVia, shareUrl: r.url } : v) }} />
              </div>
            )}
            <ReportReadView report={view} />
            {canEdit && view.status === 'final' && !view.sentAt && (
              <button type="button" onClick={reopen} disabled={busy}
                className="mt-4 px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50">
                {busy ? '…' : '✏️ Edit report'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
