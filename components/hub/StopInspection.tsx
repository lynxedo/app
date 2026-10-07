'use client'

// Work Orders — the irrigation inspection opened ON TOP of the stop, so the tech
// never leaves Work Orders (Ben, Oct 5 2026: "navigating to the inspection
// form, customer file and back to work orders is not quick and easy").
// Same form and same API as the customer file's Irrigation card; closing or
// saving lands back on the stop, where the suggested line items are waiting.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import IrrigationForm, { type FullInspection as FormInspection } from '@/app/hub/contacts/[id]/IrrigationForm'
import { ReadView, type FullInspection } from '@/app/hub/contacts/[id]/IrrigationSection'

export default function StopInspection({ contactId, stopId, inspectionId, mode, customerHref, onClose }: {
  contactId: string
  stopId: string
  /** The saved (or draft) inspection to open; omit to start or resume this stop's draft. */
  inspectionId?: string | null
  mode: 'edit' | 'view'
  customerHref: string
  /** `changed` = a draft was saved/finalized — refresh the stop. */
  onClose: (changed: boolean) => void
}) {
  const [form, setForm] = useState<FormInspection | null>(null)
  const [view, setView] = useState<FullInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reopening, setReopening] = useState(false)

  // Ben, Oct 7 2026: a finished inspection can be opened again to edit (the
  // customer's latest one only — the API checks).
  async function editIt() {
    if (!view || reopening) return
    setReopening(true); setError(null)
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/irrigation/${view.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || 'Could not open it for editing'); return }
      const r = await fetch(`/api/hub/contacts/${contactId}/irrigation?inspId=${encodeURIComponent(view.id)}`)
      const g = await r.json().catch(() => ({}))
      if (!r.ok || !g.inspection) { setError(g.error || 'Could not open it for editing'); return }
      setForm(g.inspection)
    } finally { setReopening(false) }
  }

  useEffect(() => {
    let cancelled = false
    async function go() {
      try {
        if (mode === 'view' && inspectionId) {
          const res = await fetch(`/api/hub/contacts/${contactId}/irrigation?inspId=${encodeURIComponent(inspectionId)}`)
          const j = await res.json()
          if (!res.ok || !j.inspection) throw new Error(j.error || 'Could not open the inspection')
          if (!cancelled) setView(j.inspection)
          return
        }
        // Start a draft tied to this stop + visit, or resume the one already there.
        const res = await fetch(`/api/hub/contacts/${contactId}/irrigation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stopId }),
        })
        const j = await res.json()
        if (!res.ok || !j.inspection) throw new Error(j.error || 'Could not start the inspection')
        if (!cancelled) setForm(j.inspection)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open the inspection')
      }
    }
    void go()
    return () => { cancelled = true }
  }, [contactId, stopId, inspectionId, mode])

  if (form) {
    return (
      <IrrigationForm
        contactId={contactId}
        inspection={form}
        onClose={() => onClose(true)}
        onFinalized={() => onClose(true)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-[var(--t-panel-deep)] text-white flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] border-b border-white/10">
        <button type="button" onClick={() => onClose(false)} className="text-sm text-white/70 hover:text-white">‹ Back to stop</button>
        <div className="flex-1 text-sm font-medium text-white/80">Irrigation inspection</div>
        {view?.status === 'final' && (
          <button type="button" onClick={editIt} disabled={reopening} className="text-xs px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white disabled:opacity-50">
            {reopening ? 'Opening…' : '✏️ Edit'}
          </button>
        )}
        <Link href={customerHref} className="text-xs text-sky-300 hover:text-sky-200">Customer file ›</Link>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}
        {!error && !view && <div className="text-sm text-white/40">Loading…</div>}
        {view && <ReadView insp={view} />}
      </div>
    </div>
  )
}
