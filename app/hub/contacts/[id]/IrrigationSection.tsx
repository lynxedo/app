'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { IrrigationData } from '@/lib/irrigation'
import { orderedDays, fmtStartTimes, fmtScheduleDate } from '@/lib/irrigation'
import IrrigationForm, { type FullInspection as FormInspection, type WorkOrderRef } from './IrrigationForm'

export type FullInspection = FormInspection & {
  inspectedOn: string | null
  finalizedAt: string | null
  by: string | null
  shareUrl: string | null
  shareExpiresAt: string | null
  stopId: string | null
  jobberVisitId: string | null
}
type HistoryItem = { id: string; finalizedAt: string | null; inspectedOn: string | null; by: string | null; zoneCount: number; workOrder?: WorkOrderRef | null }
type LoadState = { canEdit: boolean; draft: FullInspection | null; latest: FullInspection | null; history: HistoryItem[] }

function fmtDate(d: string | null): string {
  if (!d) return ''
  const iso = d.length === 10 ? d + 'T00:00:00' : d
  const dt = new Date(iso)
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Card({ title, action, children, id }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-[var(--t-panel)] border border-white/10 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-medium text-white/70">{title}</h2>
        <div className="flex items-center gap-2">{action}</div>
      </div>
      {children}
    </section>
  )
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-white/45 shrink-0">{label}</span>
      <span className="text-right text-white/85 min-w-0 break-words">{value}</span>
    </div>
  )
}
const btn = 'px-2.5 py-1.5 rounded-md text-xs font-medium'

export function ReadView({ insp }: { insp: FullInspection }) {
  const d: IrrigationData = insp.data || {}
  const zones = Array.isArray(d.zones) ? d.zones.filter(z => z.zone || z.area || z.head || z.count || z.issues) : []
  const controller = [d.ctrlBrand, d.ctrlModel].filter(Boolean).join(' ')
  const schedDays = orderedDays(d.schedDays)
  const schedStarts = fmtStartTimes(d.schedStarts)
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-white/40">
        Inspected {fmtDate(insp.inspectedOn || insp.finalizedAt) || '—'}{insp.by ? ` · ${insp.by}` : ''}
      </div>
      {insp.workOrder && (
        <div className="text-[11px] text-white/40 -mt-2">
          From work order · {fmtDate(insp.workOrder.date)}{insp.workOrder.tech ? ` · ${insp.workOrder.tech}` : ''} ·{' '}
          <Link
            href={`/hub/daily-log-v2?date=${encodeURIComponent(insp.workOrder.date)}&stop=${encodeURIComponent(insp.workOrder.stopId)}`}
            className="text-sky-300 hover:underline"
          >
            Open the day →
          </Link>
        </div>
      )}

      <div>
        <Row label="Water source" value={(d.source ?? []).join(', ')} />
        <Row label="Static pressure" value={d.psi ? `${d.psi} PSI` : ''} />
        <Row label="Controller" value={controller} />
        <Row label="Controller type" value={d.ctrlType} />
        <Row label="Stations" value={d.stationsUsed && d.stationsTotal ? `${d.stationsUsed} of ${d.stationsTotal}` : (d.stationsTotal || '')} />
        <Row label="Controller location" value={d.ctrlLoc} />
        <Row label="Backflow" value={[d.bfType, d.bfCond].filter(Boolean).join(' · ')} />
        <Row label="Backflow location" value={d.bfLoc} />
        <Row label="Main shutoff" value={d.isoMain} />
        <Row label="Meter location" value={d.meterLoc} />
        <Row label="Valve boxes" value={d.vbCount ? `${d.vbCount}${d.vbLocs ? ` — ${d.vbLocs}` : ''}` : d.vbLocs} />
        <Row label="Overall condition" value={d.overallCond ? <span className="capitalize">{d.overallCond}</span> : ''} />
        <Row label="Maintenance plan" value={d.maintPlan === 'yes' ? 'Yes' : d.maintPlan === 'no' ? 'No' : ''} />
      </div>

      {(schedDays.length > 0 || schedStarts.length > 0 || d.programs || d.schedAdjustOn || (d.schedAdjustChanges?.length ?? 0) > 0 || d.schedAdjustNote) && (
        <div className="pt-2 border-t border-white/5">
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-1.5">Watering schedule</div>
          <Row label="Days" value={schedDays.join(', ')} />
          <Row label="Start times" value={schedStarts.join(', ')} />
          <Row label="Programs" value={d.programs ? <span className="text-white/70">{d.programs}</span> : ''} />
          <Row label="Next adjustment" value={[fmtScheduleDate(d.schedAdjustOn), (d.schedAdjustChanges ?? []).join(', ')].filter(Boolean).join(' · ')} />
          <Row label="Adjustment details" value={d.schedAdjustNote ? <span className="text-white/70">{d.schedAdjustNote}</span> : ''} />
        </div>
      )}

      {zones.length > 0 && (
        <div className="pt-2 border-t border-white/5">
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-1.5">Zones ({zones.length})</div>
          <div className="space-y-1.5">
            {zones.map((z, i) => (
              <div key={i} className="text-sm">
                <span className="text-white/85">{z.zone ? `Zone ${z.zone}` : `Zone ${i + 1}`}</span>
                {z.area && <span className="text-white/60"> — {z.area}</span>}
                <div className="text-[12px] text-white/45">
                  {[z.head, z.count ? `${z.count} heads` : '', z.valve ? `valve: ${z.valve}` : ''].filter(Boolean).join(' · ')}
                  {z.issues && <span className="text-orange-300"> · {z.issues}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(d.repairs || (d.upgrades?.length ?? 0) > 0 || d.estValue || d.extraNotes) && (
        <div className="pt-2 border-t border-white/5 space-y-1">
          {d.repairs && <Row label="Repairs needed" value={<span className="text-white/70">{d.repairs}</span>} />}
          {(d.upgrades?.length ?? 0) > 0 && <Row label="Recommendations" value={d.upgrades!.join(', ')} />}
          {d.estValue && <Row label="Est. value" value={d.estValue} />}
          {d.extraNotes && <Row label="Notes" value={<span className="text-white/60">{d.extraNotes}</span>} />}
        </div>
      )}

      {d.finalNotes && (
        <div className="pt-2 border-t border-white/5">
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-1">Final notes &amp; recommendations</div>
          <div className="text-sm text-white/75 whitespace-pre-wrap">{d.finalNotes}</div>
        </div>
      )}

      {(insp.sketchUrl || insp.photoUrls.length > 0) && (
        <div className="pt-2 border-t border-white/5 flex flex-wrap gap-2">
          {insp.sketchUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={insp.sketchUrl} target="_blank" rel="noopener noreferrer"><img src={insp.sketchUrl} alt="System sketch" className="w-28 h-20 object-cover rounded border border-white/10 bg-white" /></a>
          )}
          {insp.photoUrls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={i} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="" className="w-20 h-20 object-cover rounded border border-white/10" /></a>
          ))}
        </div>
      )}
    </div>
  )
}

export default function IrrigationSection({ contactId }: { contactId: string }) {
  const [state, setState] = useState<LoadState | null>(null)
  const [viewing, setViewing] = useState<FullInspection | null>(null) // a specific history entry
  const [formInsp, setFormInsp] = useState<FormInspection | null>(null)
  const [busy, setBusy] = useState(false)
  const [texting, setTexting] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/irrigation`)
      if (!res.ok) { setState({ canEdit: false, draft: null, latest: null, history: [] }); return }
      setState(await res.json())
    } catch { setState({ canEdit: false, draft: null, latest: null, history: [] }) }
  }, [contactId])

  useEffect(() => { void load() }, [load])

  // Deep links open the inspection straight away, so a tech tapping a link
  // lands in the form (or the report) instead of hunting for this card:
  //   ?irrigation=new                      — from Jobber (the original link)
  //   ?irrigation=new&stop=<id>&visit=<id> — from a stop on the Work Order list:
  //                                          the draft is tied to that stop + visit
  //   ?irrigation=open&insp=<id>           — view a saved report (from a stop)
  //
  // Reads window.location rather than useSearchParams() so the component keeps
  // rendering without a Suspense boundary, and strips the parameters once used —
  // otherwise a refresh or a Back would start a second inspection.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current || formInsp || !state) return
    const q = new URLSearchParams(window.location.search)
    const mode = q.get('irrigation')
    if (mode !== 'new' && mode !== 'open') return
    // Viewing rides on Hub access like the card itself; starting needs the grant —
    // without it leave them on the card, don't half-open a form.
    if (mode === 'new' && !state.canEdit) return
    autoStarted.current = true
    const stopId = q.get('stop')
    const inspId = q.get('insp')
    for (const k of ['irrigation', 'stop', 'visit', 'insp']) q.delete(k)
    const rest = q.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
    if (mode === 'new') void startOrResume(stopId ? { stopId } : undefined)
    else if (inspId) void openInspection(inspId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, formInsp])

  // The Work orders card on this same page asks us to open a report in place.
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (id) void openInspection(id)
    }
    window.addEventListener('lx:open-inspection', onOpen)
    return () => window.removeEventListener('lx:open-inspection', onOpen)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, state?.canEdit])

  async function startOrResume(ctx?: { stopId: string }) {
    if (busy) return
    setBusy(true); setToast('')
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/irrigation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx ?? {}),
      })
      const j = await res.json()
      if (res.ok && j.inspection) setFormInsp(j.inspection)
      else if (!res.ok) setToast(j.error || 'Could not start the inspection')
    } finally { setBusy(false) }
  }

  /** Open one inspection by id: a draft goes to the form (with the grant), a saved one to the read view. */
  async function openInspection(id: string) {
    setToast('')
    const res = await fetch(`/api/hub/contacts/${contactId}/irrigation?inspId=${encodeURIComponent(id)}`)
    if (!res.ok) return
    const j = await res.json()
    if (!j.inspection) return
    if (j.inspection.status === 'draft' && state?.canEdit) setFormInsp(j.inspection)
    else setViewing(j.inspection)
  }

  async function openHistory(id: string) {
    setToast('')
    const res = await fetch(`/api/hub/contacts/${contactId}/irrigation?inspId=${id}`)
    if (res.ok) { const j = await res.json(); setViewing(j.inspection) }
  }

  async function textSummary(inspId: string) {
    if (texting) return
    setTexting(true); setToast('')
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/irrigation/${inspId}/text`, { method: 'POST' })
      const j = await res.json()
      setToast(res.ok ? '✓ Summary texted to the customer' : (j.error || 'Could not send'))
    } catch { setToast('Could not send') } finally { setTexting(false) }
  }

  if (!state) return <Card title="Irrigation system"><div className="text-xs text-white/40">Loading…</div></Card>

  const { canEdit, draft, latest, history } = state
  const shown = viewing ?? latest

  // The full-screen form takes over when open.
  if (formInsp) {
    return (
      <IrrigationForm
        contactId={contactId}
        inspection={formInsp}
        onClose={() => { setFormInsp(null); void load() }}
        onFinalized={() => { setFormInsp(null); setToast('✓ Inspection saved'); void load() }}
      />
    )
  }

  return (
    <Card
      id="irrigation-card"
      title="Irrigation system"
      action={canEdit && (
        <button type="button" onClick={() => startOrResume()} disabled={busy}
          className={`${btn} bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50`}>
          {busy ? '…' : draft ? 'Resume draft' : latest ? '+ New inspection' : '+ Start inspection'}
        </button>
      )}
    >
      {toast && <div className="mb-2 text-xs text-emerald-300">{toast}</div>}

      {draft && canEdit && (
        <div className="mb-3 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
          A draft inspection is in progress — tap “Resume draft” to finish it.
        </div>
      )}

      {!shown ? (
        <div className="text-xs text-white/40">No irrigation inspection on file yet.{canEdit ? ' Tap “Start inspection” to add one.' : ''}</div>
      ) : (
        <>
          {viewing && (
            <button type="button" onClick={() => setViewing(null)} className="text-xs text-sky-300 hover:text-sky-200 mb-2">← Back to latest</button>
          )}
          <ReadView insp={shown} />

          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-white/5">
            {canEdit && !viewing && shown.status === 'final' && (
              <button type="button" onClick={() => textSummary(shown.id)} disabled={texting}
                className={`${btn} bg-white/10 hover:bg-white/20 text-white/80 disabled:opacity-50`}>
                {texting ? 'Sending…' : '💬 Text system summary'}
              </button>
            )}
            {shown.shareUrl && (
              <a href={shown.shareUrl} target="_blank" rel="noopener noreferrer" className={`${btn} bg-white/10 hover:bg-white/20 text-white/60`}>View customer link ↗</a>
            )}
          </div>
        </>
      )}

      {history.length > (viewing ? 0 : 1) && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-1.5">Visit history</div>
          <div className="flex flex-col gap-1">
            {history.map(h => (
              <button key={h.id} type="button" onClick={() => openHistory(h.id)}
                className={`text-left text-sm px-2 py-1.5 rounded hover:bg-white/5 flex items-center justify-between gap-2 ${viewing?.id === h.id ? 'bg-white/5' : ''}`}>
                <span className="text-white/80">{fmtDate(h.inspectedOn || h.finalizedAt) || 'Inspection'}</span>
                <span className="text-[11px] text-white/40">{[h.by, `${h.zoneCount} zones`, h.workOrder ? '📋 work order' : null].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
