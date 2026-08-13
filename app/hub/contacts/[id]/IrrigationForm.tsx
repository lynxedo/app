'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IrrigationData, IrrigationZone } from '@/lib/irrigation'
import {
  emptyIrrigationZone, mergeDictatedZones, confirmZoneMarks, reindexZoneMarks,
  ZONE_WATERS, ZONE_HEADS, ZONE_SUN, ZONE_SLOPE,
} from '@/lib/irrigation'
import { fieldMark } from '@/lib/irrigation-fields'
import ZoneDictation from './ZoneDictation'
import PhotoFill from './PhotoFill'

export type FullInspection = {
  id: string
  status: string
  data: IrrigationData
  sketchUrl: string | null
  photoKeys: string[]
  photoUrls: string[]
}

const SOURCES = ['Municipal / City', 'Well', 'Reclaimed (purple pipe)', 'Pond / Lake', 'Booster pump']
const ACCESSORIES = ['Rain sensor', 'Freeze sensor', 'Soil moisture', 'Weather / ET', 'Flow sensor']
const BF_TYPES = ['PVB', 'RPZ / RP', 'DCV / DC', 'AVB', 'None visible']
const UPGRADES = ['Smart controller', 'MP Rotators', 'Drip conversion', 'Pressure regulation', 'Rain / weather sensor', 'Head replacement']
// The zone vocabularies live in lib/irrigation.ts because the dictation endpoint
// validates against the same lists — a spoken value can only become something a
// tech could have picked here.
const WATERS = ZONE_WATERS
const HEADS = ZONE_HEADS
const SUN = ZONE_SUN
const SLOPE = ZONE_SLOPE

const inpStyle = { fontSize: 16 } as const
const inp = 'w-full px-3 py-2.5 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30 min-h-[44px]'

function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] uppercase tracking-wide text-white/45 font-medium mb-1">{children}</span>
}

// A field carrying a dictated value the tech hasn't looked at yet. Amber is the
// whole point of the feature: it turns "re-read 140 fields" into "check the
// handful that came from the microphone".
const aiRing = 'border-amber-500/70 bg-amber-500/10'

function TextField({ label, value, onChange, placeholder, inputMode, ai, onConfirm, aiFrom }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
  inputMode?: 'text' | 'numeric' | 'tel'
  ai?: boolean; onConfirm?: () => void; aiFrom?: 'notes' | 'photo'
}) {
  return (
    <label className="block">
      <Lbl>{label}{ai && <span className="ml-1 text-amber-400 normal-case tracking-normal">• from {aiFrom ?? 'notes'}</span>}</Lbl>
      <input value={value} onChange={e => { onChange(e.target.value); onConfirm?.() }} placeholder={placeholder}
        onFocus={() => onConfirm?.()}
        inputMode={inputMode} className={`${inp} ${ai ? aiRing : ''}`} style={inpStyle} />
    </label>
  )
}

function SelectField({ label, value, onChange, options, ai, onConfirm, aiFrom }: {
  label: string; value: string; onChange: (v: string) => void; options: readonly string[]
  ai?: boolean; onConfirm?: () => void; aiFrom?: 'notes' | 'photo'
}) {
  return (
    <label className="block">
      <Lbl>{label}{ai && <span className="ml-1 text-amber-400 normal-case tracking-normal">• from {aiFrom ?? 'notes'}</span>}</Lbl>
      <select value={value} onChange={e => { onChange(e.target.value); onConfirm?.() }}
        onFocus={() => onConfirm?.()}
        className={`${inp} ${ai ? aiRing : ''}`} style={inpStyle}>
        <option value=""></option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

function Chips({ label, options, selected, onToggle, single, ai, onConfirm }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; single?: boolean
  ai?: boolean; onConfirm?: () => void
}) {
  return (
    <div className={ai ? 'rounded-md border border-amber-500/70 bg-amber-500/10 p-2 -m-2' : undefined}
      onPointerDown={ai ? () => onConfirm?.() : undefined}>
      <Lbl>{label}{ai && <span className="ml-1 text-amber-400 normal-case tracking-normal">• from photo</span>}</Lbl>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const on = selected.includes(o)
          return (
            <button key={o} type="button" onClick={() => onToggle(o)}
              className={`text-[13px] px-3 py-2 rounded-full border transition min-h-[40px] ${on ? 'bg-sky-600/90 border-sky-500 text-white' : 'border-white/15 text-white/60 hover:border-white/30'}`}>
              {single && on ? '● ' : ''}{o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Seg({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; label: string; tone?: 'good' | 'warn' | 'bad' }[]
}) {
  const tone: Record<string, string> = { good: 'bg-emerald-600 border-emerald-500', warn: 'bg-amber-600 border-amber-500', bad: 'bg-red-600 border-red-500' }
  return (
    <div>
      <Lbl>{label}</Lbl>
      <div className="flex rounded-md overflow-hidden border border-white/15">
        {options.map((o, i) => {
          const on = value === o.v
          const onCls = o.tone ? tone[o.tone] : 'bg-sky-600 border-sky-500'
          return (
            <button key={o.v} type="button" onClick={() => onChange(on ? '' : o.v)}
              className={`flex-1 min-h-[46px] text-[13px] uppercase tracking-wide ${i > 0 ? 'border-l border-white/10' : ''} ${on ? `${onCls} text-white` : 'text-white/55'}`}>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SectionHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mt-6 mb-3">
      <span className="w-6 h-6 rounded-md bg-sky-600 text-white text-xs font-semibold grid place-items-center shrink-0">{n}</span>
      <h3 className="text-[15px] font-medium">{title}</h3>
    </div>
  )
}

export default function IrrigationForm({ contactId, inspection, onClose, onFinalized }: {
  contactId: string
  inspection: FullInspection
  onClose: () => void
  onFinalized: () => void
}) {
  const [data, setData] = useState<IrrigationData>(() => ({
    ...inspection.data,
    zones: Array.isArray(inspection.data.zones) && inspection.data.zones.length
      ? inspection.data.zones
      : Array.from({ length: 6 }, () => emptyIrrigationZone()),
  }))
  const [photos, setPhotos] = useState<{ key: string; url: string }[]>(
    () => inspection.photoKeys.map((key, i) => ({ key, url: inspection.photoUrls[i] || '' })),
  )
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [finalizing, setFinalizing] = useState(false)
  const [err, setErr] = useState('')

  const dataRef = useRef(data); dataRef.current = data
  const photosRef = useRef(photos); photosRef.current = photos
  const sketchDirty = useRef(false)
  const sketchKeyRef = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Field setters ──────────────────────────────────────────────────────────
  const set = useCallback(<K extends keyof IrrigationData>(k: K, v: IrrigationData[K]) => {
    setData(d => ({ ...d, [k]: v })); scheduleSave()
  }, [])
  const toggleIn = useCallback((k: 'source' | 'accessories' | 'upgrades', v: string) => {
    setData(d => {
      const arr = new Set(d[k] ?? [])
      if (arr.has(v)) arr.delete(v); else arr.add(v)
      return { ...d, [k]: Array.from(arr) }
    })
    scheduleSave()
  }, [])
  const setZone = useCallback((i: number, patch: Partial<IrrigationZone>) => {
    setData(d => {
      const zones = [...(d.zones ?? [])]; zones[i] = { ...zones[i], ...patch }; return { ...d, zones }
    })
    scheduleSave()
  }, [])
  const addZone = useCallback(() => setData(d => ({ ...d, zones: [...(d.zones ?? []), emptyIrrigationZone()] })), [])
  const removeZone = useCallback((i: number) => {
    setData(d => ({
      ...d,
      zones: (d.zones ?? []).filter((_, j) => j !== i),
      // Marks are positional — re-key them or the amber highlight slides onto
      // whichever zone happens to shift up into the deleted row's place.
      aiFilled: reindexZoneMarks(d.aiFilled ?? [], i),
    }))
    scheduleSave()
  }, [])

  // ── Dictation ──────────────────────────────────────────────────────────────
  const [dictateNote, setDictateNote] = useState('')

  const applyDictation = useCallback((dictated: Partial<IrrigationZone>[]) => {
    // Merged off the ref, not inside the setData updater — an updater must be
    // pure (React runs it twice in dev StrictMode), so the summary message is
    // computed here and set alongside rather than as a side effect within it.
    const d = dataRef.current
    const merged = mergeDictatedZones(d.zones ?? [], dictated, d.aiFilled ?? [])
    const untouched = dictated.length - merged.touched.length
    setDictateNote(
      merged.fieldsWritten === 0
        ? 'Nothing new — you’d already filled those in'
        : `Filled ${merged.fieldsWritten} field${merged.fieldsWritten === 1 ? '' : 's'} across `
          + `${merged.touched.length} zone${merged.touched.length === 1 ? '' : 's'}`
          + (untouched > 0 ? ` · ${untouched} left alone (already filled in)` : ''),
    )
    setData(prev => ({ ...prev, zones: merged.zones, aiFilled: merged.aiFilled }))
    scheduleSave()
  }, [])

  const marks = data.aiFilled ?? []
  const isAi = useCallback((i: number, field: keyof IrrigationZone) => marks.includes(`${i}:${field}`), [marks])
  const clearMark = useCallback((i: number, field: keyof IrrigationZone) => {
    setData(d => {
      const key = `${i}:${field}`
      if (!(d.aiFilled ?? []).includes(key)) return d
      return { ...d, aiFilled: (d.aiFilled ?? []).filter(k => k !== key) }
    })
  }, [])
  const confirmZone = useCallback((i: number) => {
    setData(d => ({ ...d, aiFilled: confirmZoneMarks(d.aiFilled ?? [], i) }))
    scheduleSave()
  }, [])

  // ── Photo fill ─────────────────────────────────────────────────────────────
  // Same rule as dictation: a read value may fill a blank, or correct a value
  // the camera itself put there that nobody has confirmed — never something the
  // tech entered.
  const applyPhoto = useCallback((
    patch: Partial<IrrigationData>, fields: string[], photoKey: string | null, previewUrl: string,
  ) => {
    const d = dataRef.current
    const nextMarks = new Set(d.aiFilled ?? [])
    const write: Record<string, unknown> = {}
    let written = 0

    for (const name of fields) {
      const value = (patch as Record<string, unknown>)[name]
      if (value == null) continue
      const current = (d as unknown as Record<string, unknown>)[name]
      const currentEmpty = Array.isArray(current)
        ? current.length === 0
        : !String(current ?? '').trim()
      const key = fieldMark(name)
      if (!currentEmpty && !nextMarks.has(key)) continue
      write[name] = value
      nextMarks.add(key)
      written++
    }

    if (written > 0) setData(prev => ({ ...prev, ...write, aiFilled: Array.from(nextMarks) }))
    // The photo is kept even when nothing was readable — the tech took it, and
    // a picture of the controller is worth having on the record either way.
    if (photoKey) setPhotos(p => [...p, { key: photoKey, url: previewUrl }])
    if (written > 0 || photoKey) scheduleSave()
    return { written, skipped: fields.length - written }
  }, [])

  const isField = useCallback((name: string) => (data.aiFilled ?? []).includes(fieldMark(name)), [data.aiFilled])
  const clearField = useCallback((name: string) => {
    setData(d => {
      const key = fieldMark(name)
      if (!(d.aiFilled ?? []).includes(key)) return d
      return { ...d, aiFilled: (d.aiFilled ?? []).filter(k => k !== key) }
    })
  }, [])

  // ── Sketch canvas ──────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  }, [])

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!; const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; last.current = pos(e); e.preventDefault() }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const c = canvasRef.current!; const ctx = c.getContext('2d')!; const p = pos(e)
    ctx.strokeStyle = '#0e7c86'; ctx.lineWidth = 2.6
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p; sketchDirty.current = true; e.preventDefault()
  }
  function up() { if (drawing.current) { drawing.current = false; scheduleSave() } }
  function clearSketch() {
    const c = canvasRef.current; if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height); sketchDirty.current = true; scheduleSave()
  }

  async function uploadCanvas(): Promise<string | null> {
    const c = canvasRef.current; if (!c) return null
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))
    if (!blob) return null
    const fd = new FormData()
    fd.append('file', new File([blob], 'sketch.png', { type: 'image/png' }))
    const res = await fetch('/api/hub/upload', { method: 'POST', body: fd })
    if (!res.ok) return null
    const j = await res.json()
    return j.storage_path || null
  }

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

  // ── Autosave ─────────────────────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    setSaveState('saving')
    try {
      const body: Record<string, unknown> = { data: dataRef.current, photo_keys: photosRef.current.map(p => p.key) }
      if (sketchDirty.current) {
        const key = await uploadCanvas()
        if (key) { body.sketch_key = key; sketchKeyRef.current = key }
        sketchDirty.current = false
      }
      const res = await fetch(`/api/hub/contacts/${contactId}/irrigation/${inspection.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      setSaveState(res.ok ? 'saved' : 'error')
    } catch { setSaveState('error') }
  }, [contactId, inspection.id])

  function scheduleSave() {
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveDraft() }, 700)
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  async function finalize() {
    if (finalizing) return
    setFinalizing(true); setErr('')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    try {
      // Flush the sketch first so the finalized snapshot includes it.
      let sketchKey: string | null | undefined
      if (sketchDirty.current) { sketchKey = await uploadCanvas(); sketchDirty.current = false }
      const body: Record<string, unknown> = { data: dataRef.current, photo_keys: photosRef.current.map(p => p.key) }
      if (sketchKey) body.sketch_key = sketchKey
      const res = await fetch(`/api/hub/contacts/${contactId}/irrigation/${inspection.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || 'Could not save inspection'); setFinalizing(false); return }
      onFinalized()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error'); setFinalizing(false)
    }
  }

  const zones = data.zones ?? []
  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'

  return (
    <div className="fixed inset-0 z-50 bg-[var(--t-panel-deep)] text-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-[var(--t-panel-deep)]">
        <button type="button" onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none" aria-label="Close">✕</button>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight">Irrigation inspection</div>
          <div className={`text-[11px] ${saveState === 'error' ? 'text-red-400' : 'text-white/40'}`}>{saveLabel}</div>
        </div>
        <button type="button" onClick={finalize} disabled={finalizing}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50">
          {finalizing ? 'Saving…' : 'Save inspection'}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 max-w-2xl w-full mx-auto">
        {err && <div className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{err}</div>}

        <SectionHead n={1} title="System overview" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Approx. install year" value={data.installYear ?? ''} onChange={v => set('installYear', v)} inputMode="numeric" placeholder="e.g. 2015" />
          <TextField label="Original installer" value={data.installer ?? ''} onChange={v => set('installer', v)} />
        </div>
        <div className="mt-3">
          <Seg label="Maintenance plan customer?" value={data.maintPlan ?? ''} onChange={v => set('maintPlan', v)}
            options={[{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }]} />
        </div>

        <SectionHead n={2} title="Water source & supply" />
        <PhotoFill contactId={contactId} inspectionId={inspection.id} section="supply" onFields={applyPhoto} />
        <div className="mt-3">
          <Chips label="Water source" options={SOURCES} selected={data.source ?? []} onToggle={v => toggleIn('source', v)}
            ai={isField('source')} onConfirm={() => clearField('source')} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <TextField label="Static pressure (PSI)" value={data.psi ?? ''} onChange={v => set('psi', v)} inputMode="numeric" ai={isField('psi')} onConfirm={() => clearField('psi')} aiFrom="photo" />
          <TextField label="Flow (GPM)" value={data.gpm ?? ''} onChange={v => set('gpm', v)} inputMode="numeric" />
          <SelectField label="Meter / service size" value={data.meterSize ?? ''} onChange={v => set('meterSize', v)} options={['3/4"', '1"', '1-1/4"', '1-1/2"', '2"', 'Unknown']} ai={isField('meterSize')} onConfirm={() => clearField('meterSize')} aiFrom="photo" />
          <SelectField label="Pressure regulator (PRV)?" value={data.prv ?? ''} onChange={v => set('prv', v)} options={['Yes — present', 'No', 'Needed']} ai={isField('prv')} onConfirm={() => clearField('prv')} aiFrom="photo" />
        </div>
        <div className="mt-3"><TextField label="Point of connection" value={data.poc ?? ''} onChange={v => set('poc', v)} placeholder="Where the system taps the supply" /></div>
        <div className="mt-3"><TextField label="Pump (well / booster)" value={data.pump ?? ''} onChange={v => set('pump', v)} placeholder="HP, tank, location" /></div>

        <SectionHead n={3} title="Controller / timer" />
        <PhotoFill contactId={contactId} inspectionId={inspection.id} section="controller" onFields={applyPhoto} />
        <div className="mt-3"><TextField label="Location" value={data.ctrlLoc ?? ''} onChange={v => set('ctrlLoc', v)} placeholder="Garage wall, exterior…" /></div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <TextField label="Brand" value={data.ctrlBrand ?? ''} onChange={v => set('ctrlBrand', v)} placeholder="Rain Bird, Hunter…" ai={isField('ctrlBrand')} onConfirm={() => clearField('ctrlBrand')} aiFrom="photo" />
          <TextField label="Model" value={data.ctrlModel ?? ''} onChange={v => set('ctrlModel', v)} ai={isField('ctrlModel')} onConfirm={() => clearField('ctrlModel')} aiFrom="photo" />
          <TextField label="Stations — total" value={data.stationsTotal ?? ''} onChange={v => set('stationsTotal', v)} inputMode="numeric" ai={isField('stationsTotal')} onConfirm={() => clearField('stationsTotal')} aiFrom="photo" />
          <TextField label="Stations — in use" value={data.stationsUsed ?? ''} onChange={v => set('stationsUsed', v)} inputMode="numeric" />
          <SelectField label="Type" value={data.ctrlType ?? ''} onChange={v => set('ctrlType', v)} options={['Conventional', 'Smart / Wi-Fi']} ai={isField('ctrlType')} onConfirm={() => clearField('ctrlType')} aiFrom="photo" />
          <SelectField label="Wi-Fi connected?" value={data.ctrlWifi ?? ''} onChange={v => set('ctrlWifi', v)} options={['Yes', 'No', 'N/A']} />
          <SelectField label="Battery backup?" value={data.ctrlBatt ?? ''} onChange={v => set('ctrlBatt', v)} options={['Yes — OK', 'Yes — dead', 'None']} />
          <SelectField label="Master valve / pump relay?" value={data.ctrlMv ?? ''} onChange={v => set('ctrlMv', v)} options={['Master valve', 'Pump start relay', 'None']} />
        </div>
        <div className="mt-3"><Chips label="Wired accessories" options={ACCESSORIES} selected={data.accessories ?? []} onToggle={v => toggleIn('accessories', v)} /></div>
        <div className="mt-3">
          <Lbl>Current programs / run times</Lbl>
          <textarea value={data.programs ?? ''} onChange={e => set('programs', e.target.value)} rows={2} className={`${inp} resize-none`} style={inpStyle} />
        </div>

        <SectionHead n={4} title="Backflow preventer" />
        <PhotoFill contactId={contactId} inspectionId={inspection.id} section="backflow" onFields={applyPhoto} />
        <div className="mt-3">
          <Chips label="Type" options={BF_TYPES} selected={data.bfType ? [data.bfType] : []} onToggle={v => set('bfType', data.bfType === v ? '' : v)} single
            ai={isField('bfType')} onConfirm={() => clearField('bfType')} />
        </div>
        <div className="mt-3"><TextField label="Location" value={data.bfLoc ?? ''} onChange={v => set('bfLoc', v)} /></div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <SelectField label="Above / below grade" value={data.bfGrade ?? ''} onChange={v => set('bfGrade', v)} options={['Above grade', 'Below grade / box']} ai={isField('bfGrade')} onConfirm={() => clearField('bfGrade')} aiFrom="photo" />
          <SelectField label="Insulated / protected?" value={data.bfInsul ?? ''} onChange={v => set('bfInsul', v)} options={['Yes', 'No']} ai={isField('bfInsul')} onConfirm={() => clearField('bfInsul')} aiFrom="photo" />
        </div>
        <div className="mt-3">
          <Seg label="Condition" value={data.bfCond ?? ''} onChange={v => set('bfCond', v)}
            options={[{ v: 'good', label: 'Good', tone: 'good' }, { v: 'fair', label: 'Fair', tone: 'warn' }, { v: 'poor', label: 'Poor', tone: 'bad' }, { v: 'fail', label: 'Leaking', tone: 'bad' }]} />
        </div>

        <SectionHead n={5} title="Shutoffs & isolation" />
        <TextField label="Main irrigation isolation valve" value={data.isoMain ?? ''} onChange={v => set('isoMain', v)} placeholder="Shuts off the whole system" />
        <div className="mt-3"><TextField label="Water meter location" value={data.meterLoc ?? ''} onChange={v => set('meterLoc', v)} /></div>
        <div className="mt-3"><TextField label="Secondary / section isolation valves" value={data.isoSecondary ?? ''} onChange={v => set('isoSecondary', v)} /></div>

        <SectionHead n={6} title="Valve boxes" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="# of valve boxes" value={data.vbCount ?? ''} onChange={v => set('vbCount', v)} inputMode="numeric" />
          <TextField label="Box locations" value={data.vbLocs ?? ''} onChange={v => set('vbLocs', v)} />
        </div>
        <div className="mt-3"><TextField label="Valves per box / wiring notes" value={data.vbNotes ?? ''} onChange={v => set('vbNotes', v)} /></div>

        <SectionHead n={7} title="Zones" />
        <ZoneDictation contactId={contactId} inspectionId={inspection.id} onZones={applyDictation} />
        {dictateNote && (
          <div className="mb-3 text-[12px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
            {dictateNote}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {zones.map((z, i) => {
            const zoneMarked = marks.some(k => k.startsWith(`${i}:`))
            return (
            <div key={i} className={`border rounded-lg bg-white/[0.03] ${zoneMarked ? 'border-amber-500/40' : 'border-white/10'}`}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                <span className="text-[13px] font-semibold text-sky-300">Zone</span>
                <input value={z.zone} onChange={e => { setZone(i, { zone: e.target.value }); clearMark(i, 'zone') }} placeholder={`${i + 1}`}
                  onFocus={() => clearMark(i, 'zone')}
                  inputMode="numeric" className={`w-14 px-2 py-1 rounded bg-white/5 border text-center text-white ${isAi(i, 'zone') ? aiRing : 'border-white/10'}`} style={inpStyle} />
                <button type="button" onClick={() => removeZone(i)} className="ml-auto text-white/40 hover:text-red-400 w-8 h-8 rounded" aria-label="Remove zone">✕</button>
              </div>
              {zoneMarked && (
                <button type="button" onClick={() => confirmZone(i)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[12px] text-amber-300 hover:bg-amber-500/20 min-h-[40px]">
                  <span className="flex-1 text-left">From your notes — check the highlighted fields</span>
                  <span className="font-medium">Looks right ✓</span>
                </button>
              )}
              <div className="p-3 grid grid-cols-2 gap-3">
                <div className="col-span-2"><TextField label="Area served" value={z.area} onChange={v => setZone(i, { area: v })} placeholder="Front lawn, back beds…" ai={isAi(i, 'area')} onConfirm={() => clearMark(i, 'area')} /></div>
                <SelectField label="Waters" value={z.waters} onChange={v => setZone(i, { waters: v })} options={WATERS} ai={isAi(i, 'waters')} onConfirm={() => clearMark(i, 'waters')} />
                <SelectField label="Head type" value={z.head} onChange={v => setZone(i, { head: v })} options={HEADS} ai={isAi(i, 'head')} onConfirm={() => clearMark(i, 'head')} />
                <TextField label="# of heads" value={z.count} onChange={v => setZone(i, { count: v })} inputMode="numeric" ai={isAi(i, 'count')} onConfirm={() => clearMark(i, 'count')} />
                <TextField label="Nozzle / brand" value={z.nozzle} onChange={v => setZone(i, { nozzle: v })} ai={isAi(i, 'nozzle')} onConfirm={() => clearMark(i, 'nozzle')} />
                <SelectField label="Sun" value={z.sun} onChange={v => setZone(i, { sun: v })} options={SUN} ai={isAi(i, 'sun')} onConfirm={() => clearMark(i, 'sun')} />
                <SelectField label="Slope" value={z.slope} onChange={v => setZone(i, { slope: v })} options={SLOPE} ai={isAi(i, 'slope')} onConfirm={() => clearMark(i, 'slope')} />
                <TextField label="Valve box loc." value={z.valve} onChange={v => setZone(i, { valve: v })} ai={isAi(i, 'valve')} onConfirm={() => clearMark(i, 'valve')} />
                <TextField label="Run time (min)" value={z.runtime} onChange={v => setZone(i, { runtime: v })} inputMode="numeric" ai={isAi(i, 'runtime')} onConfirm={() => clearMark(i, 'runtime')} />
                <div className="col-span-2"><TextField label="Condition / issues" value={z.issues} onChange={v => setZone(i, { issues: v })} placeholder="Broken heads, coverage gaps, leaks" ai={isAi(i, 'issues')} onConfirm={() => clearMark(i, 'issues')} /></div>
              </div>
            </div>
            )
          })}
        </div>
        <button type="button" onClick={addZone} className="mt-3 px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm">+ Add zone</button>

        <SectionHead n={8} title="Condition & recommendations" />
        <Seg label="Overall system condition" value={data.overallCond ?? ''} onChange={v => set('overallCond', v)}
          options={[{ v: 'good', label: 'Good', tone: 'good' }, { v: 'fair', label: 'Fair', tone: 'warn' }, { v: 'poor', label: 'Poor', tone: 'bad' }]} />
        <div className="mt-3">
          <Lbl>Immediate repairs needed <span className="text-white/30 normal-case tracking-normal">(internal)</span></Lbl>
          <textarea value={data.repairs ?? ''} onChange={e => set('repairs', e.target.value)} rows={2} className={`${inp} resize-none`} style={inpStyle} />
        </div>
        <div className="mt-3"><Chips label="Recommended upgrades (shown to customer)" options={UPGRADES} selected={data.upgrades ?? []} onToggle={v => toggleIn('upgrades', v)} /></div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <TextField label="Photos note (internal)" value={data.photosNote ?? ''} onChange={v => set('photosNote', v)} />
          <TextField label="Est. follow-up value (internal)" value={data.estValue ?? ''} onChange={v => set('estValue', v)} />
        </div>
        <div className="mt-3">
          <Lbl>Additional notes <span className="text-white/30 normal-case tracking-normal">(internal)</span></Lbl>
          <textarea value={data.extraNotes ?? ''} onChange={e => set('extraNotes', e.target.value)} rows={2} className={`${inp} resize-none`} style={inpStyle} />
        </div>

        <SectionHead n={9} title="Property sketch" />
        <p className="text-[12px] text-white/40 mb-2">Draw the yard and mark the controller (C), backflow (B), shutoff (S), meter (M), valve boxes (V), and zone numbers. Drawing here replaces the map on file.</p>
        <div className="rounded-lg overflow-hidden border border-white/15 bg-white">
          <canvas ref={canvasRef} width={900} height={560}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            className="block w-full touch-none cursor-crosshair" style={{ height: 'auto', backgroundImage: 'linear-gradient(#e5e7eb 1px,transparent 1px),linear-gradient(90deg,#e5e7eb 1px,transparent 1px)', backgroundSize: '26px 26px' }} />
        </div>
        <button type="button" onClick={clearSketch} className="mt-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm">Clear sketch</button>

        <SectionHead n={10} title="Photos" />
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border border-white/10 bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.url ? <img src={p.url} alt="" className="w-full h-full object-cover" /> : <div className="grid place-items-center h-full text-white/30 text-xs">photo</div>}
              <button type="button" onClick={() => removePhoto(i)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs">✕</button>
            </div>
          ))}
          <label className="w-20 h-20 rounded-md border border-dashed border-white/20 grid place-items-center cursor-pointer text-white/40 hover:border-white/40 text-2xl">
            {uploadingPhoto ? '…' : '+'}
            <input type="file" accept="image/*" multiple className="hidden" onChange={e => { void addPhotos(e.target.files); e.currentTarget.value = '' }} />
          </label>
        </div>
      </div>
    </div>
  )
}
