'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { observationLabel, MOWING, type AfterServiceData } from '@/lib/after-service'
import AfterServiceForm, { fmtReportDate, type FullReport } from './AfterServiceForm'

// Work Orders Phase 3 — the customer file's After-service reports card, built
// like the Irrigation card (Ben, Oct 5 2026). Reports are started from the stop
// on the Work Order list (each belongs to one visit); here the office and techs
// see the history, open any report, and continue a draft. The card stays hidden
// for a customer who has never had one, so it doesn't clutter every file.

type ListItem = {
  id: string
  status: 'draft' | 'final'
  serviceDate: string | null
  finalizedAt: string | null
  sentAt: string | null
  by: string | null
  services: string[]
  stopId: string | null
}

const btn = 'px-2.5 py-1.5 rounded-md text-xs font-medium'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-white/45 shrink-0">{label}</span>
      <span className="text-right text-white/85 min-w-0 break-words">{value}</span>
    </div>
  )
}

/** The whole report for staff — customer-facing parts AND the internal products/notes. */
export function ReportReadView({ report }: { report: FullReport }) {
  const d: AfterServiceData = report.data || {}
  const mowing = MOWING.find(m => m.v === d.mowingHeight)?.label
  const products = d.products ?? []
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-white/40">
        {report.status === 'final' ? 'Saved' : 'Draft'} · {fmtReportDate(report.serviceDate || report.finalizedAt) || '—'}{report.by ? ` · ${report.by}` : ''}
        {report.sentAt && <span className="text-emerald-300"> · ✓ Sent {fmtReportDate(report.sentAt)}</span>}
      </div>
      {report.workOrder && (
        <div className="text-[11px] text-white/40 -mt-2">
          From work order ·{' '}
          <Link href={`/hub/daily-log-v2?date=${encodeURIComponent(report.workOrder.date)}&stop=${encodeURIComponent(report.workOrder.stopId)}`}
            className="text-sky-300 hover:underline">Open the day →</Link>
        </div>
      )}

      {(d.services?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-1">What was done</div>
          {d.services!.map((s, i) => <div key={i} className="text-sm text-white/85">• {s.name}{s.qty && s.qty !== 1 ? ` × ${s.qty}` : ''}</div>)}
        </div>
      )}

      {((d.observations?.length ?? 0) > 0 || mowing || d.observationNotes) && (
        <div className="pt-2 border-t border-white/5">
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-1">What we saw</div>
          <Row label="Noted" value={(d.observations ?? []).map(observationLabel).join(', ')} />
          <Row label="Mowing height" value={mowing} />
          {d.observationNotes && <div className="text-sm text-white/70 whitespace-pre-wrap mt-1">{d.observationNotes}</div>}
        </div>
      )}

      {((d.recommendations?.length ?? 0) > 0 || d.recommendationNotes) && (
        <div className="pt-2 border-t border-white/5">
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-1">Recommendations</div>
          {(d.recommendations?.length ?? 0) > 0 && <div className="text-sm text-white/85">{d.recommendations!.join(', ')}</div>}
          {d.recommendationNotes && <div className="text-sm text-white/70 whitespace-pre-wrap mt-1">{d.recommendationNotes}</div>}
        </div>
      )}

      {products.length > 0 && (
        <div className="pt-2 border-t border-white/5">
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-1">Products applied <span className="normal-case tracking-normal text-white/30">(internal)</span></div>
          {products.map(p => (
            <div key={p.key} className="text-sm py-0.5">
              <span className={p.applied === 'no' ? 'text-white/40 line-through' : 'text-white/85'}>{p.name}</span>
              <span className="text-[12px] text-white/45">
                {p.applied === 'yes' ? ` · ${p.amount || p.mappedRate || 'applied'}` : p.applied === 'no' ? ' · not applied' : ' · not answered'}
                {p.added ? ' · added by tech' : ''}
                {p.note ? ` · ${p.note}` : ''}
              </span>
            </div>
          ))}
          {report.pesticideRecordId && (
            <Link href={`/hub/pesticide-records/${report.pesticideRecordId}`} className="text-[12px] text-emerald-300 hover:underline">🧪 Pesticide record →</Link>
          )}
        </div>
      )}

      {d.internalNotes && <Row label="Internal notes" value={<span className="text-white/60">{d.internalNotes}</span>} />}

      {report.photoUrls.length > 0 && (
        <div className="pt-2 border-t border-white/5 flex flex-wrap gap-2">
          {report.photoUrls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={i} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="" className="w-20 h-20 object-cover rounded border border-white/10" /></a>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AfterServiceSection({ contactId }: { contactId: string }) {
  const [list, setList] = useState<{ canEdit: boolean; reports: ListItem[] } | null>(null)
  const [viewing, setViewing] = useState<FullReport | null>(null)
  const [formReport, setFormReport] = useState<FullReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/service-reports`)
      setList(res.ok ? await res.json() : { canEdit: false, reports: [] })
    } catch { setList({ canEdit: false, reports: [] }) }
  }, [contactId])
  useEffect(() => { void load() }, [load])

  const openReport = useCallback(async (id: string) => {
    setToast('')
    const res = await fetch(`/api/hub/contacts/${contactId}/service-reports?reportId=${encodeURIComponent(id)}`)
    if (!res.ok) return
    const j = await res.json()
    if (!j.report) return
    if (j.report.status === 'draft' && j.canEdit) setFormReport(j.report)
    else setViewing(j.report)
  }, [contactId])

  // ?asr=open&report=<id> — from the stop or a link; stripped once used.
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current || !list) return
    const q = new URLSearchParams(window.location.search)
    if (q.get('asr') !== 'open') return
    autoOpened.current = true
    const id = q.get('report')
    q.delete('asr'); q.delete('report')
    const rest = q.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
    if (id) void openReport(id)
  }, [list, openReport])

  // The Work orders card on this page asks us to open a report in place.
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (id) void openReport(id)
    }
    window.addEventListener('lx:open-service-report', onOpen)
    return () => window.removeEventListener('lx:open-service-report', onOpen)
  }, [openReport])

  async function reopen(id: string) {
    if (busy) return
    setBusy(true); setToast('')
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/service-reports/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setToast(j.error || 'Could not reopen the report'); return }
      setViewing(null)
      await openReport(id)
      void load()
    } finally { setBusy(false) }
  }

  if (formReport) {
    return (
      <AfterServiceForm
        contactId={contactId}
        report={formReport}
        onClose={() => { setFormReport(null); void load() }}
        onSaved={() => { setFormReport(null); setToast('✓ Report saved'); void load() }}
      />
    )
  }

  // Hidden until this customer has a report — they're started from the stop.
  if (!list || list.reports.length === 0) return null
  const { canEdit, reports } = list

  return (
    <section id="service-report-card" className="bg-[var(--t-panel)] border border-white/10 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-medium text-white/70">After-service reports</h2>
        <span className="text-[11px] text-white/40">{reports.length} report{reports.length === 1 ? '' : 's'}</span>
      </div>
      {toast && <div className="mb-2 text-xs text-emerald-300">{toast}</div>}

      {viewing ? (
        <>
          <button type="button" onClick={() => setViewing(null)} className="text-xs text-sky-300 hover:text-sky-200 mb-2">← All reports</button>
          <ReportReadView report={viewing} />
          {canEdit && viewing.status === 'final' && !viewing.sentAt && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <button type="button" onClick={() => reopen(viewing.id)} disabled={busy}
                className={`${btn} bg-white/10 hover:bg-white/20 text-white/80 disabled:opacity-50`}>
                {busy ? '…' : '✏️ Edit report'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1">
          {reports.map(r => (
            <button key={r.id} type="button" onClick={() => openReport(r.id)}
              className="text-left text-sm px-2 py-1.5 rounded hover:bg-white/5 flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="text-white/80">{fmtReportDate(r.serviceDate || r.finalizedAt) || 'Report'}</span>
                {r.services.length > 0 && <span className="text-[12px] text-white/40"> · {r.services[0]}{r.services.length > 1 ? ` +${r.services.length - 1}` : ''}</span>}
              </span>
              <span className="text-[11px] text-white/40 shrink-0">
                {r.status === 'draft'
                  ? <span className="text-amber-300">{canEdit ? 'Draft — continue' : 'Draft'}</span>
                  : r.sentAt ? <span className="text-emerald-300">✓ Sent</span> : 'Saved'}
                {r.by ? ` · ${r.by}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
