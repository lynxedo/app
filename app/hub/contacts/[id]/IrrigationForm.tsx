'use client'

import RachioTestRun from './RachioTestRun'
import RachioImport, { type RachioImportPayload } from './RachioImport'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IrrigationData, IrrigationZone, DictatedZone } from '@/lib/irrigation'
import {
  emptyIrrigationZone, mergeDictatedZones, confirmZoneMarks, reindexZoneMarks, sortZones,
  ZONE_WATERS, ZONE_HEADS, ZONE_SUN, ZONE_SLOPE, WEEKDAYS, SCHEDULE_CHANGES,
} from '@/lib/irrigation'
import { fieldMark } from '@/lib/irrigation-fields'
import ZoneDictation from './ZoneDictation'
import PhotoFill from './PhotoFill'
import FinalNotes from './FinalNotes'

/** Work Orders Phase 1 — the stop this inspection was done from ("From work order · Oct 1 · Josh"). */
export type WorkOrderRef = { stopId: string; date: string; tech: string | null; status: string }

export type FullInspection = {
  id: string
  status: string
  data: IrrigationData
  sketchUrl: string | null
  photoKeys: string[]
  photoUrls: string[]
  workOrder?: WorkOrderRef | null
}

function fmtWorkOrderDate(d: string): string {
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d)
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

/** Keys for `n` cards: the ones we have, plus fresh unique ones. Pure. */
function padKeys(keys: number[], n: number): number[] {
  if (keys.length >= n) return keys.slice(0, n)
  let next = keys.length ? Math.max(...keys) + 1 : 0
  const out = [...keys]
  while (out.length < n) out.push(next++)
  return out
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
  // ── Offline (Ben, Oct 12 2026) ────────────────────────────────────────────
  // A dead-signal yard used to turn every edit into a red "Not saved". Now a
  // save that can't reach the server is kept on the phone (one snapshot per
  // inspection, last write wins) and pushed when the signal returns — or when
  // the form is next opened, if it was closed first. Finish still needs signal.
  const pendingKey = `lx_irr_pending:${inspection.id}`
  const [pending] = useState<{ data: IrrigationData; photo_keys: string[]; at: number } | null>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(pendingKey) : null
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const [data, setData] = useState<IrrigationData>(() => {
    const base = pending?.data ?? inspection.data
    const zones = Array.isArray(base.zones) && base.zones.length
      ? base.zones
      : Array.from({ length: 6 }, () => emptyIrrigationZone())
    const sorted = sortZones(zones, base.aiFilled ?? [])
    return { ...base, zones: sorted.zones, aiFilled: sorted.aiFilled }
  })
  const [photos, setPhotos] = useState<{ key: string; url: string }[]>(() => {
    const known = new Map(inspection.photoKeys.map((key, i) => [key, inspection.photoUrls[i] || '']))
    const keys = pending?.photo_keys ?? inspection.photoKeys
    return keys.map(key => ({ key, url: known.get(key) ?? '' }))
  })
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | 'offline'>(pending ? 'offline' : 'saved')
  const saveStateRef = useRef(saveState); saveStateRef.current = saveState
  /** Photos taken with no signal — uploaded when it returns (lost if the form closes first; the form says so). */
  const [pendingUploads, setPendingUploads] = useState<{ file: File; url: string }[]>([])
  const [finalizing, setFinalizing] = useState(false)
  const [err, setErr] = useState('')

  const dataRef = useRef(data); dataRef.current = data
  // Stable React keys for the zone cards. Cards re-sort by zone number, and an
  // index key would hand the field the tech just tapped to whichever zone slid
  // into that slot. Kept beside the rows and permuted with them.
  const [zoneKeys, setZoneKeys] = useState<number[]>(() => (data.zones ?? []).map((_, i) => i))
  const photosRef = useRef(photos); photosRef.current = photos
  const sketchDirty = useRef(false)
  const sketchKeyRef = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Field setters ──────────────────────────────────────────────────────────
  const set = useCallback(<K extends keyof IrrigationData>(k: K, v: IrrigationData[K]) => {
    setData(d => ({ ...d, [k]: v })); scheduleSave()
  }, [])
  const toggleIn = useCallback((k: 'source' | 'accessories' | 'upgrades' | 'schedDays' | 'schedAdjustChanges', v: string) => {
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
  // Start times — several per watering day is normal (cycle-and-soak, split programs).
  const setStart = useCallback((i: number, v: string) => {
    setData(d => { const starts = [...(d.schedStarts ?? [])]; starts[i] = v; return { ...d, schedStarts: starts } })
    scheduleSave()
  }, [])
  const addStart = useCallback(() => setData(d => ({ ...d, schedStarts: [...(d.schedStarts ?? []), ''] })), [])
  const removeStart = useCallback((i: number) => {
    setData(d => ({ ...d, schedStarts: (d.schedStarts ?? []).filter((_, j) => j !== i) }))
    scheduleSave()
  }, [])
  const addZone = useCallback(() => {
    setData(d => ({ ...d, zones: [...(d.zones ?? []), emptyIrrigationZone()] }))
    setZoneKeys(k => padKeys(k, k.length + 1))
  }, [])
  const removeZone = useCallback((i: number) => {
    setZoneKeys(k => k.filter((_, j) => j !== i))
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

  // Put the cards in zone-number order (after a zone number is typed, and after
  // dictation). Computed off the ref, outside a setData updater, because it also
  // permutes the card keys — an updater may run twice.
  const sortCards = useCallback((d: IrrigationData) => {
    const res = sortZones(d.zones ?? [], d.aiFilled ?? [])
    const n = res.order.length
    setZoneKeys(k => { const p = padKeys(k, n); return res.order.map(i => p[i]) })
    return { ...d, zones: res.zones, aiFilled: res.aiFilled, changed: res.changed }
  }, [])
  const sortNow = useCallback(() => {
    const { changed, ...next } = sortCards(dataRef.current)
    if (!changed) return
    setData(next); scheduleSave()
  }, [sortCards])

  const getZones = useCallback(() => dataRef.current.zones ?? [], [])

  const applyDictation = useCallback((dictated: DictatedZone[]) => {
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
    const { changed: _changed, ...sorted } = sortCards({ ...d, zones: merged.zones, aiFilled: merged.aiFilled })
    void _changed
    setData(prev => ({ ...prev, zones: sorted.zones, aiFilled: sorted.aiFilled }))
    scheduleSave()
  }, [sortCards])

  const marks = data.aiFilled ?? []
  const isAi = useCallback((i: number, field: keyof IrrigationZone) => marks.includes(`${i}:${field}`), [marks])
  // Which zone cards have "More" open by hand (keyed by the stable zone key, so
  // a re-sort doesn't hand the open state to whichever zone slid into the slot).
  const [moreOpen, setMoreOpen] = useState<Set<number>>(() => new Set())
  const toggleMore = (k: number) => setMoreOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
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

  // ── Import from Rachio / Quick run ─────────────────────────────────────────
  const [rachioOn, setRachioOn] = useState(true)
  // Same rules as the photo and voice fills: blanks only, amber until checked.
  const applyRachio = useCallback((p: RachioImportPayload): string => {
    const sys = applyPhoto(p.system, p.systemFields, null, '')
    if (p.deviceId) setData(d => ({ ...d, rachioDeviceId: p.deviceId }))
    const before = (dataRef.current.zones ?? []).length
    applyDictation(p.zones)
    return `From “${p.controllerName}”: ${p.zones.length} zone${p.zones.length === 1 ? '' : 's'}${before ? ' (filled into blanks only)' : ''}, ${sys.written} controller / schedule field${sys.written === 1 ? '' : 's'}.`
  }, [applyPhoto, applyDictation])

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
  // fetch() throws a TypeError when there is no connection at all — that is the
  // only failure we keep on the phone; a server "no" stays a red "Not saved".
  const isNoSignal = (e: unknown) => e instanceof TypeError
  async function uploadOne(file: File): Promise<string | null> {
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/hub/upload', { method: 'POST', body: fd })
    if (!res.ok) return null
    const j = await res.json()
    return (j.storage_path as string | undefined) ?? null
  }
  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingPhoto(true)
    try {
      for (const file of Array.from(files)) {
        try {
          const key = await uploadOne(file)
          if (key) setPhotos(p => [...p, { key, url: URL.createObjectURL(file) }])
        } catch (e) {
          if (!isNoSignal(e)) continue
          setPendingUploads(p => [...p, { file, url: URL.createObjectURL(file) }])
        }
      }
      scheduleSave()
    } finally { setUploadingPhoto(false) }
  }
  function removePhoto(i: number) { setPhotos(p => p.filter((_, j) => j !== i)); scheduleSave() }
  function removePendingUpload(i: number) { setPendingUploads(p => p.filter((_, j) => j !== i)) }

  // ── Autosave ─────────────────────────────────────────────────────────────
  const stashLocally = useCallback(() => {
    try {
      window.localStorage.setItem(pendingKey, JSON.stringify({ data: dataRef.current, photo_keys: photosRef.current.map(p => p.key), at: Date.now() }))
    } catch { /* storage full or blocked — the in-memory form still has it */ }
  }, [pendingKey])
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
      if (res.ok) { try { window.localStorage.removeItem(pendingKey) } catch {} }
      setSaveState(res.ok ? 'saved' : 'error')
    } catch (e) {
      if (isNoSignal(e)) { stashLocally(); setSaveState('offline') } else { setSaveState('error') }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, inspection.id, pendingKey, stashLocally])

  function scheduleSave() {
    // Keep showing "on this phone" rather than flashing "Saving…" while offline —
    // the snapshot is refreshed on every edit so nothing is lost either way.
    if (saveStateRef.current === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      // Write after React has applied the edit (dataRef updates on render).
      setTimeout(stashLocally, 0)
      setSaveState('offline')
    } else {
      setSaveState('saving')
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveDraft() }, 700)
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // Pending work goes up the moment the signal returns, and every 15 s while
  // we're offline (the browser's `online` event is not reliable in a webview).
  // A snapshot restored from the phone is pushed on open the same way.
  const pendingUploadsRef = useRef(pendingUploads); pendingUploadsRef.current = pendingUploads
  useEffect(() => {
    let busy = false
    const flush = async () => {
      if (busy) return
      busy = true
      try {
        if (saveStateRef.current === 'offline') await saveDraft()
        if (saveStateRef.current !== 'offline' && pendingUploadsRef.current.length > 0) {
          for (const pu of [...pendingUploadsRef.current]) {
            try {
              const key = await uploadOne(pu.file)
              setPendingUploads(p => p.filter(x => x !== pu))
              if (key) setPhotos(p => [...p, { key, url: pu.url }])
            } catch (e) { if (isNoSignal(e)) break }
          }
          void saveDraft()
        }
      } finally { busy = false }
    }
    const onOnline = () => { void flush() }
    window.addEventListener('online', onOnline)
    const t = setInterval(() => { if (saveStateRef.current === 'offline' || pendingUploadsRef.current.length > 0) void flush() }, 15_000)
    if (pending) void flush()
    return () => { window.removeEventListener('online', onOnline); clearInterval(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveDraft])

  async function finalize() {
    if (finalizing) return
    setFinalizing(true); setErr('')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // Finishing dates the snapshot and offers the customer summary — it needs the
    // server. Edits are safe on the phone; only this tap waits for signal.
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || saveStateRef.current === 'offline') {
      stashLocally()
      setErr('No signal — everything is saved on this phone. Tap Finish again when it returns.')
      setFinalizing(false)
      return
    }
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
      if (isNoSignal(e)) { stashLocally(); setSaveState('offline'); setErr('No signal — everything is saved on this phone. Tap Finish again when it returns.') }
      else setErr(e instanceof Error ? e.message : 'Network error')
      setFinalizing(false)
    }
  }

  const zones = data.zones ?? []
  const saveLabel = saveState === 'saving' ? 'Saving…'
    : saveState === 'error' ? 'Not saved'
    : saveState === 'offline' ? `Saved on this phone — will sync when signal returns${pendingUploads.length ? ` · ${pendingUploads.length} photo${pendingUploads.length === 1 ? '' : 's'} waiting` : ''}`
    : 'Saved'

  return (
    <div className="fixed inset-0 z-50 bg-[var(--t-panel-deep)] text-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] border-b border-white/10 bg-[var(--t-panel-deep)]">
        <button type="button" onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none" aria-label="Close">✕</button>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight">Irrigation inspection</div>
          <div className={`text-[11px] ${saveState === 'error' ? 'text-red-400' : saveState === 'offline' ? 'text-amber-300' : 'text-white/40'}`}>
            {saveLabel === 'Saved' ? 'Draft saved — close any time and come back to it' : saveLabel}
            {inspection.workOrder && (
              <span className="text-white/40"> · From work order · {fmtWorkOrderDate(inspection.workOrder.date)}{inspection.workOrder.tech ? ` · ${inspection.workOrder.tech}` : ''}</span>
            )}
          </div>
        </div>
        <button type="button" onClick={finalize} disabled={finalizing}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50">
          {finalizing ? 'Finishing…' : 'Finish inspection'}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 max-w-2xl w-full mx-auto">
        {err && <div className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{err}</div>}

        <RachioImport contactId={contactId} inspectionId={inspection.id} onImport={applyRachio} onConnected={setRachioOn} />

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

        <SectionHead n={4} title="Watering schedule" />
        <Chips label="Watering days" options={[...WEEKDAYS]} selected={data.schedDays ?? []} onToggle={v => toggleIn('schedDays', v)} />
        <div className="mt-3">
          <Lbl>Start times</Lbl>
          <div className="flex flex-col gap-2">
            {(data.schedStarts?.length ? data.schedStarts : ['']).map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="time" value={t} onChange={e => setStart(i, e.target.value)}
                  className={inp} style={{ ...inpStyle, colorScheme: 'dark' }} aria-label={`Start time ${i + 1}`} />
                {(data.schedStarts?.length ?? 0) > 1 && (
                  <button type="button" onClick={() => removeStart(i)} className="shrink-0 text-white/40 hover:text-red-400 w-10 h-10 rounded" aria-label="Remove start time">✕</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addStart} className="mt-2 px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm">+ Add start time</button>
        </div>
        <div className="mt-3">
          <Lbl>Programs / run times (details)</Lbl>
          <textarea value={data.programs ?? ''} onChange={e => set('programs', e.target.value)} rows={2} placeholder="Program A: zones 1–4, 15 min…" className={`${inp} resize-none`} style={inpStyle} />
        </div>
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[13px] font-medium text-sky-200 mb-2">Next schedule adjustment</div>
          <label className="block">
            <Lbl>Adjust on (approx.)</Lbl>
            <input type="date" value={data.schedAdjustOn ?? ''} onChange={e => set('schedAdjustOn', e.target.value)}
              className={inp} style={{ ...inpStyle, colorScheme: 'dark' }} />
          </label>
          <div className="mt-3">
            <Chips label="What to change" options={[...SCHEDULE_CHANGES]} selected={data.schedAdjustChanges ?? []} onToggle={v => toggleIn('schedAdjustChanges', v)} />
          </div>
          <div className="mt-3">
            <TextField label="Details" value={data.schedAdjustNote ?? ''} onChange={v => set('schedAdjustNote', v)} placeholder="e.g. drop to Tue / Sat once temps stay under 85°" />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-white/35">The schedule is shown on the customer&apos;s summary.</p>

        <SectionHead n={5} title="Backflow preventer" />
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

        <SectionHead n={6} title="Shutoffs & isolation" />
        <TextField label="Main irrigation isolation valve" value={data.isoMain ?? ''} onChange={v => set('isoMain', v)} placeholder="Shuts off the whole system" />
        <div className="mt-3"><TextField label="Water meter location" value={data.meterLoc ?? ''} onChange={v => set('meterLoc', v)} /></div>
        <div className="mt-3"><TextField label="Secondary / section isolation valves" value={data.isoSecondary ?? ''} onChange={v => set('isoSecondary', v)} /></div>

        <SectionHead n={7} title="Valve boxes" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="# of valve boxes" value={data.vbCount ?? ''} onChange={v => set('vbCount', v)} inputMode="numeric" />
          <TextField label="Box locations" value={data.vbLocs ?? ''} onChange={v => set('vbLocs', v)} />
        </div>
        <div className="mt-3"><TextField label="Valves per box / wiring notes" value={data.vbNotes ?? ''} onChange={v => set('vbNotes', v)} /></div>

        <SectionHead n={8} title="Zones" />
        <ZoneDictation contactId={contactId} inspectionId={inspection.id} getZones={getZones} onZones={applyDictation} />
        {rachioOn && <RachioTestRun contactId={contactId} inspectionId={inspection.id} deviceId={data.rachioDeviceId ?? null} />}
        {dictateNote && (
          <div className="mb-3 text-[12px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
            {dictateNote}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {zones.map((z, i) => {
            const zoneMarked = marks.some(k => k.startsWith(`${i}:`))
            return (
            <div key={zoneKeys[i] ?? `new-${i}`} className={`border rounded-lg bg-white/[0.03] ${zoneMarked ? 'border-amber-500/40' : 'border-white/10'}`}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                <span className="text-[13px] font-semibold text-sky-300">Zone</span>
                <input value={z.zone} onChange={e => { setZone(i, { zone: e.target.value }); clearMark(i, 'zone') }} placeholder={`${i + 1}`}
                  onFocus={() => clearMark(i, 'zone')}
                  onBlur={sortNow}
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
              {/* 6 core fields; the other 5 fold under "More" (Ben, Oct 12 2026).
                  A zone opens on its own when a detail field holds a value or an
                  amber AI fill, so nothing dictated or imported ever hides. */}
              <div className="p-3 grid grid-cols-2 gap-3">
                <div className="col-span-2"><TextField label="Area served" value={z.area} onChange={v => setZone(i, { area: v })} placeholder="Front lawn, back beds…" ai={isAi(i, 'area')} onConfirm={() => clearMark(i, 'area')} /></div>
                <SelectField label="Head type" value={z.head} onChange={v => setZone(i, { head: v })} options={HEADS} ai={isAi(i, 'head')} onConfirm={() => clearMark(i, 'head')} />
                <SelectField label="Sun" value={z.sun} onChange={v => setZone(i, { sun: v })} options={SUN} ai={isAi(i, 'sun')} onConfirm={() => clearMark(i, 'sun')} />
                <TextField label="Run time (min)" value={z.runtime} onChange={v => setZone(i, { runtime: v })} inputMode="numeric" ai={isAi(i, 'runtime')} onConfirm={() => clearMark(i, 'runtime')} />
                <div className="col-span-2"><TextField label="Condition / issues" value={z.issues} onChange={v => setZone(i, { issues: v })} placeholder="Broken heads, coverage gaps, leaks" ai={isAi(i, 'issues')} onConfirm={() => clearMark(i, 'issues')} /></div>
              </div>
              {(() => {
                const detailHas = !!(z.waters || z.count || z.nozzle || z.slope || z.valve)
                  || (['waters', 'count', 'nozzle', 'slope', 'valve'] as const).some(f => isAi(i, f))
                const open = detailHas || moreOpen.has(zoneKeys[i] ?? -1)
                return (
                  <>
                    <button type="button" onClick={() => toggleMore(zoneKeys[i] ?? -1)} disabled={detailHas}
                      className="w-full flex items-center justify-between px-3 py-2 border-t border-white/10 text-[12px] text-white/50 hover:text-white/80 min-h-[40px] disabled:cursor-default"
                      aria-expanded={open}>
                      <span>{open ? 'Less' : 'More'} — waters, # of heads, nozzle, slope, valve box</span>
                      <span aria-hidden>{open ? '▴' : '▾'}</span>
                    </button>
                    {open && (
                      <div className="px-3 pb-3 grid grid-cols-2 gap-3">
                        <SelectField label="Waters" value={z.waters} onChange={v => setZone(i, { waters: v })} options={WATERS} ai={isAi(i, 'waters')} onConfirm={() => clearMark(i, 'waters')} />
                        <TextField label="# of heads" value={z.count} onChange={v => setZone(i, { count: v })} inputMode="numeric" ai={isAi(i, 'count')} onConfirm={() => clearMark(i, 'count')} />
                        <TextField label="Nozzle / brand" value={z.nozzle} onChange={v => setZone(i, { nozzle: v })} ai={isAi(i, 'nozzle')} onConfirm={() => clearMark(i, 'nozzle')} />
                        <SelectField label="Slope" value={z.slope} onChange={v => setZone(i, { slope: v })} options={SLOPE} ai={isAi(i, 'slope')} onConfirm={() => clearMark(i, 'slope')} />
                        <TextField label="Valve box loc." value={z.valve} onChange={v => setZone(i, { valve: v })} ai={isAi(i, 'valve')} onConfirm={() => clearMark(i, 'valve')} />
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
            )
          })}
        </div>
        <button type="button" onClick={addZone} className="mt-3 px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm">+ Add zone</button>

        <SectionHead n={9} title="Condition & recommendations" />
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

        <SectionHead n={10} title="Property sketch" />
        <p className="text-[12px] text-white/40 mb-2">Draw the yard and mark the controller (C), backflow (B), shutoff (S), meter (M), valve boxes (V), and zone numbers. Drawing here replaces the map on file.</p>
        <div className="rounded-lg overflow-hidden border border-white/15 bg-white">
          <canvas ref={canvasRef} width={900} height={560}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            className="block w-full touch-none cursor-crosshair" style={{ height: 'auto', backgroundImage: 'linear-gradient(#e5e7eb 1px,transparent 1px),linear-gradient(90deg,#e5e7eb 1px,transparent 1px)', backgroundSize: '26px 26px' }} />
        </div>
        <button type="button" onClick={clearSketch} className="mt-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm">Clear sketch</button>

        <SectionHead n={11} title="Photos" />
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border border-white/10 bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.url ? <img src={p.url} alt="" className="w-full h-full object-cover" /> : <div className="grid place-items-center h-full text-white/30 text-xs">photo</div>}
              <button type="button" onClick={() => removePhoto(i)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs">✕</button>
            </div>
          ))}
          {pendingUploads.map((p, i) => (
            <div key={`pending-${i}`} className="relative w-20 h-20 rounded-md overflow-hidden border border-dashed border-amber-400/60 bg-white/5" title="Waiting for signal to upload — keep the form open">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="w-full h-full object-cover opacity-60" />
              <div className="absolute inset-x-0 bottom-0 bg-amber-500/80 text-[9px] text-black text-center leading-tight py-0.5">waiting for signal</div>
              <button type="button" onClick={() => removePendingUpload(i)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs" aria-label="Discard photo">✕</button>
            </div>
          ))}
          <label className="w-20 h-20 rounded-md border border-dashed border-white/20 grid place-items-center cursor-pointer text-white/40 hover:border-white/40 text-2xl">
            {uploadingPhoto ? '…' : '+'}
            <input type="file" accept="image/*" multiple className="hidden" onChange={e => { void addPhotos(e.target.files); e.currentTarget.value = '' }} />
          </label>
        </div>

        <SectionHead n={12} title="Final notes & recommendations" />
        <p className="text-[12px] text-white/40 mb-2">Anything that didn&apos;t fit elsewhere. Shown to the customer — use <em>Additional notes (internal)</em> above for office-only notes.</p>
        <FinalNotes contactId={contactId} inspectionId={inspection.id} value={data.finalNotes ?? ''} onChange={v => set('finalNotes', v)} />
      </div>
    </div>
  )
}
