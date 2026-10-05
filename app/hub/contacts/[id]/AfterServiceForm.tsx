'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  OBSERVATIONS, MOWING, RECOMMENDATIONS, newAddedProduct, unansweredProducts,
  type AfterServiceData, type AsrProduct,
} from '@/lib/after-service'

// Work Orders Phase 3 — the after-service report form (WF / MO stops). Same
// shape as IrrigationForm: full screen, autosaves the draft, "Save report"
// turns it into the saved snapshot. Opened from the stop (on top of Work
// Orders) or from the customer file's After-service reports card.

export type WorkOrderRef = { stopId: string; date: string; tech: string | null; status: string }

export type FullReport = {
  id: string
  status: string
  data: AfterServiceData
  photoKeys: string[]
  photoUrls: string[]
  serviceDate: string | null
  finalizedAt: string | null
  sentAt: string | null
  sentVia: string[]
  by: string | null
  stopId: string | null
  jobberVisitId: string | null
  pesticideRecordId: string | null
  workOrder: WorkOrderRef | null
  /** The customer's link, while it is live (set once the report has been sent). */
  shareUrl?: string | null
}

export function fmtReportDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d)
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const inpStyle = { fontSize: 16 } as const
const inp = 'w-full px-3 py-2.5 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30 min-h-[44px]'

function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] uppercase tracking-wide text-white/45 font-medium mb-1">{children}</span>
}

function SectionHead({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div className="mt-6 mb-3">
      <div className="flex items-center gap-2.5">
        <span className="w-6 h-6 rounded-md bg-emerald-600 text-white text-xs font-semibold grid place-items-center shrink-0">{n}</span>
        <h3 className="text-[15px] font-medium">{title}</h3>
      </div>
      {note && <p className="text-[12px] text-white/40 mt-1 ml-[34px]">{note}</p>}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-[13px] px-3 py-2 rounded-full border transition min-h-[40px] ${on ? 'bg-emerald-600/90 border-emerald-500 text-white' : 'border-white/15 text-white/60 hover:border-white/30'}`}>
      {children}
    </button>
  )
}

/** Applied / Not applied — the tech's answer for one product. */
function AppliedSeg({ value, onChange }: { value: AsrProduct['applied']; onChange: (v: AsrProduct['applied']) => void }) {
  const opts: { v: 'yes' | 'no'; label: string; cls: string }[] = [
    { v: 'yes', label: 'Applied', cls: 'bg-emerald-600 border-emerald-500' },
    { v: 'no', label: 'Not applied', cls: 'bg-gray-600 border-gray-500' },
  ]
  return (
    <div className="flex rounded-md overflow-hidden border border-white/15">
      {opts.map((o, i) => {
        const on = value === o.v
        return (
          <button key={o.v} type="button" onClick={() => onChange(on ? '' : o.v)}
            className={`flex-1 min-h-[44px] text-[13px] ${i > 0 ? 'border-l border-white/10' : ''} ${on ? `${o.cls} text-white` : 'text-white/55'}`}>
            {on ? '● ' : ''}{o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function AfterServiceForm({ contactId, report, onClose, onSaved }: {
  contactId: string
  report: FullReport
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<AfterServiceData>(() => report.data ?? {})
  const [photos, setPhotos] = useState<{ key: string; url: string }[]>(
    () => report.photoKeys.map((key, i) => ({ key, url: report.photoUrls[i] || '' })),
  )
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // The autosave timer and Save read the latest form through these.
  const dataRef = useRef(data)
  const photosRef = useRef(photos)
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { photosRef.current = photos }, [photos])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Autosave ─────────────────────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    setSaveState('saving')
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/service-reports/${report.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataRef.current, photo_keys: photosRef.current.map(p => p.key) }),
      })
      setSaveState(res.ok ? 'saved' : 'error')
    } catch { setSaveState('error') }
  }, [contactId, report.id])

  const scheduleSave = useCallback(() => {
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveDraft() }, 700)
  }, [saveDraft])
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // ── Setters ──────────────────────────────────────────────────────────────
  const set = useCallback(<K extends keyof AfterServiceData>(k: K, v: AfterServiceData[K]) => {
    setData(d => ({ ...d, [k]: v })); scheduleSave()
  }, [scheduleSave])
  const toggleIn = useCallback((k: 'observations' | 'recommendations', v: string) => {
    setData(d => {
      const s = new Set(d[k] ?? [])
      if (s.has(v)) s.delete(v); else s.add(v)
      return { ...d, [k]: Array.from(s) }
    })
    scheduleSave()
  }, [scheduleSave])
  const setProduct = useCallback((key: string, patch: Partial<AsrProduct>) => {
    setData(d => ({ ...d, products: (d.products ?? []).map(p => (p.key === key ? { ...p, ...patch } : p)) }))
    scheduleSave()
  }, [scheduleSave])
  const addProduct = useCallback(() => {
    setData(d => ({ ...d, products: [...(d.products ?? []), newAddedProduct(d.products ?? [])] }))
    scheduleSave()
  }, [scheduleSave])
  const removeProduct = useCallback((key: string) => {
    setData(d => ({ ...d, products: (d.products ?? []).filter(p => p.key !== key) }))
    scheduleSave()
  }, [scheduleSave])

  // ── Photos ─────────────────────────────────────────────────────────────────
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingPhoto(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData(); fd.append('file', file)
        const res = await fetch('/api/hub/upload', { method: 'POST', body: fd })
        if (!res.ok) continue
        const j = await res.json()
        if (j.storage_path) setPhotos(p => [...p, { key: j.storage_path, url: URL.createObjectURL(file) }])
      }
      scheduleSave()
    } finally { setUploadingPhoto(false) }
  }
  function removePhoto(i: number) { setPhotos(p => p.filter((_, j) => j !== i)); scheduleSave() }

  // ── Save (draft → saved report) ────────────────────────────────────────────
  async function save() {
    if (saving) return
    const missing = unansweredProducts(dataRef.current)
    if (missing.length > 0) {
      setErr(`Mark ${missing.length === 1 ? `“${missing[0].name}”` : `each product`} as Applied or Not applied first.`)
      document.getElementById('asr-products')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setSaving(true); setErr('')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/service-reports/${report.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataRef.current, photo_keys: photosRef.current.map(p => p.key) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The server looked at the stop again — a newly mapped product may need an answer.
        if (j.data) setData(j.data)
        setErr(j.error || 'Could not save the report')
        setSaving(false)
        return
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error'); setSaving(false)
    }
  }

  const services = data.services ?? []
  const products = data.products ?? []
  const obs = data.observations ?? []
  const recs = data.recommendations ?? []
  const w = data.weather
  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'

  return (
    <div className="fixed inset-0 z-50 bg-[var(--t-panel-deep)] text-white flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] border-b border-white/10 bg-[var(--t-panel-deep)]">
        <button type="button" onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none" aria-label="Close">✕</button>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight">After-service report</div>
          <div className={`text-[11px] ${saveState === 'error' ? 'text-red-400' : 'text-white/40'}`}>
            {saveLabel}
            {report.workOrder && (
              <span> · {fmtReportDate(report.workOrder.date)}{report.workOrder.tech ? ` · ${report.workOrder.tech}` : ''}</span>
            )}
          </div>
        </div>
        <button type="button" onClick={save} disabled={saving}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50">
          {saving ? 'Saving…' : 'Save report'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-28 max-w-2xl w-full mx-auto">
        {err && <div className="mt-3 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{err}</div>}

        <SectionHead n={1} title="What was done" note="From the work order’s line items." />
        {services.length === 0 ? (
          <div className="text-sm text-white/40">No line items on this work order.</div>
        ) : (
          <ul className="space-y-1">
            {services.map((s, i) => (
              <li key={i} className="text-sm text-white/85">• {s.name}{s.qty && s.qty !== 1 ? <span className="text-white/45"> × {s.qty}</span> : null}</li>
            ))}
          </ul>
        )}
        {(data.treatments?.length ?? 0) > 0 && (
          <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[11px] uppercase tracking-wide text-white/40 mb-1">What the customer will read</div>
            {data.treatments!.map((t, i) => (
              <div key={i} className="mt-1.5">
                <div className="text-sm text-white/85">{t.display}{t.round ? <span className="text-white/45"> · {t.round}</span> : null}</div>
                {t.description && <div className="text-[12px] text-white/55">{t.description}</div>}
              </div>
            ))}
            <div className="text-[11px] text-white/30 mt-2">The office writes this text (Work Orders office → Report text). Care instructions are added too.</div>
          </div>
        )}
        {w && (typeof w.temperature_f === 'number' || w.conditions) && (
          <div className="text-[12px] text-white/40 mt-2">
            Weather: {[typeof w.temperature_f === 'number' ? `${w.temperature_f}°F` : null, w.conditions, typeof w.wind_mph === 'number' ? `wind ${w.wind_mph} mph` : null].filter(Boolean).join(' · ')}
          </div>
        )}

        <div id="asr-products" />
        <SectionHead n={2} title="Products applied" note="Office and TDA record only — the customer never sees product names." />
        {products.length === 0 && (
          <div className="text-sm text-white/40 mb-2">No products are mapped to these services. Add one if you applied something.</div>
        )}
        <div className="space-y-3">
          {products.map(p => (
            <div key={p.key} className={`rounded-lg border p-3 ${p.applied === '' ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 bg-white/[0.03]'}`}>
              {p.added ? (
                <div className="flex items-start gap-2 mb-2">
                  <input value={p.name} onChange={e => setProduct(p.key, { name: e.target.value })} placeholder="Product name"
                    className={inp} style={inpStyle} />
                  <button type="button" onClick={() => removeProduct(p.key)} className="shrink-0 w-11 h-11 rounded-md bg-white/10 hover:bg-white/20 text-white/70" aria-label="Remove product">✕</button>
                </div>
              ) : (
                <div className="mb-2">
                  <div className="text-sm font-medium text-white/90">{p.name}</div>
                  <div className="text-[12px] text-white/45">
                    {[p.mappedRate ? `Mapped rate ${p.mappedRate}` : null, p.epa ? `EPA ${p.epa}` : null, p.forService ? `for ${p.forService}` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
              )}
              <AppliedSeg value={p.applied} onChange={v => setProduct(p.key, { applied: v })} />
              {p.applied === 'yes' && (
                <div className="mt-2">
                  <Lbl>Amount actually used</Lbl>
                  <input value={p.amount} onChange={e => setProduct(p.key, { amount: e.target.value })}
                    placeholder={p.mappedRate ? `Leave blank if it was ${p.mappedRate}` : 'e.g. 2.5 gal'} className={inp} style={inpStyle} />
                </div>
              )}
              {p.applied !== '' && (
                <div className="mt-2">
                  <Lbl>{p.applied === 'no' ? 'Why not?' : 'Note'}</Lbl>
                  <input value={p.note} onChange={e => setProduct(p.key, { note: e.target.value })} className={inp} style={inpStyle} />
                </div>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addProduct} className="mt-2 px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm">+ Add a product not listed</button>

        <SectionHead n={3} title="What you saw" note="Shown to the customer." />
        <div className="flex flex-wrap gap-1.5">
          {OBSERVATIONS.map(o => <Chip key={o.key} on={obs.includes(o.key)} onClick={() => toggleIn('observations', o.key)}>{o.label}</Chip>)}
        </div>
        <div className="mt-3">
          <Lbl>Mowing height</Lbl>
          <div className="flex rounded-md overflow-hidden border border-white/15">
            {MOWING.map((m, i) => {
              const on = data.mowingHeight === m.v
              return (
                <button key={m.v} type="button" onClick={() => set('mowingHeight', on ? '' : m.v)}
                  className={`flex-1 min-h-[44px] text-[13px] ${i > 0 ? 'border-l border-white/10' : ''} ${on ? (m.v === 'ok' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white') : 'text-white/55'}`}>
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="mt-3">
          <Lbl>Notes for the customer</Lbl>
          <textarea value={data.observationNotes ?? ''} onChange={e => set('observationNotes', e.target.value)} rows={3}
            placeholder="e.g. Some dollarweed along the back fence — we treated it today."
            className={`${inp} resize-none`} style={inpStyle} />
        </div>

        <SectionHead n={4} title="Recommendations" note="Shown to the customer." />
        <div className="flex flex-wrap gap-1.5">
          {RECOMMENDATIONS.map(r => <Chip key={r} on={recs.includes(r)} onClick={() => toggleIn('recommendations', r)}>{r}</Chip>)}
        </div>
        <div className="mt-3">
          <Lbl>Recommendation details</Lbl>
          <textarea value={data.recommendationNotes ?? ''} onChange={e => set('recommendationNotes', e.target.value)} rows={2}
            placeholder="e.g. Water twice a week, early morning, until the next visit."
            className={`${inp} resize-none`} style={inpStyle} />
        </div>

        <SectionHead n={5} title="Photos" note="Shown to the customer." />
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border border-white/10 bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.url ? <img src={p.url} alt="" className="w-full h-full object-cover" /> : <div className="grid place-items-center h-full text-white/30 text-xs">photo</div>}
              <button type="button" onClick={() => removePhoto(i)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs" aria-label="Remove photo">✕</button>
            </div>
          ))}
          <label className="w-20 h-20 rounded-md border border-dashed border-white/20 grid place-items-center cursor-pointer text-white/40 hover:border-white/40 text-2xl">
            {uploadingPhoto ? '…' : '+'}
            <input type="file" accept="image/*" multiple className="hidden" onChange={e => { void addPhotos(e.target.files); e.currentTarget.value = '' }} />
          </label>
        </div>

        <SectionHead n={6} title="Internal notes" note="Office only — never shown to the customer." />
        <textarea value={data.internalNotes ?? ''} onChange={e => set('internalNotes', e.target.value)} rows={2}
          className={`${inp} resize-none`} style={inpStyle} />
      </div>
    </div>
  )
}
