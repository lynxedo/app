'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useConfirm } from '@/components/ui'
import type { Product } from '@/lib/products'
import {
  type ServiceProduct, type LineItemName,
  type MatchType, MATCH_TYPES, TANK_OPTIONS,
  mixBatchKey, datedBatchesOverlap, naturalCompare, isPlaceholderDate, placeholderStarts, todayInTz,
} from '@/lib/service-mapping'

const inputCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500'
const btn = 'px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50'
const btnPrimary = 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[#fff] disabled:opacity-50'

// The "no program yet" bucket in the program picker.
const UNASSIGNED = '__unassigned__'

// Add N days to a YYYY-MM-DD string (used by "duplicate round forward").
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// A "round" = the mapping rows of a line item that share a date window + label.
type Batch = {
  key: string
  label: string | null
  start: string | null
  end: string | null
  rows: ServiceProduct[]
  draft: boolean        // every row inactive — invisible to Mix Sheet / Pesticide / Loadout
  placeholder: boolean  // parked on a fake year-2000 date (real dates not set yet)
  alwaysOn: boolean     // no dates — the fallback mix used when no dated round covers a date
}
type LineItemGroup = { lineItem: string; program: string | null; batches: Batch[]; hasOverlap: boolean }

function buildBatches(rows: ServiceProduct[]): Batch[] {
  const byBatch = new Map<string, ServiceProduct[]>()
  for (const sp of rows) {
    const k = mixBatchKey(sp)
    const arr = byBatch.get(k) ?? []
    arr.push(sp); byBatch.set(k, arr)
  }
  const batches: Batch[] = [...byBatch.entries()].map(([key, rs]) => {
    const start = rs[0].effective_start, end = rs[0].effective_end
    return {
      key, label: rs[0].batch_label, start, end, rows: rs,
      draft: rs.every(r => !r.is_active),
      placeholder: isPlaceholderDate(start),
      alwaysOn: start == null && end == null,
    }
  })
  // Live dated rounds first (in date order), the always-on fallback next, drafts last.
  const bucket = (b: Batch) => (b.draft || b.placeholder) ? 2 : b.alwaysOn ? 1 : 0
  batches.sort((a, b) =>
    bucket(a) - bucket(b) ||
    (a.start ?? '').localeCompare(b.start ?? '') ||
    naturalCompare(a.label ?? '', b.label ?? ''))
  return batches
}

// "Round N" suggestion for a new round: one past the highest round number in
// use ("July 2026"-style labels are ignored, not read as round 2026).
function nextRoundLabel(batches: Batch[]): string {
  let max = 0
  for (const b of batches) {
    const m = (b.label ?? '').match(/round\s*(\d+)/i)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `Round ${max + 1}`
}

// The fields a copied/duplicated product row carries into its new round.
function cloneRowFields(r: ServiceProduct) {
  return {
    product_id: r.product_id, match_type: r.match_type,
    application_rate: r.application_rate, rate_unit: r.rate_unit, alt_group: r.alt_group,
    tank_default: r.tank_default, notes: r.notes, show_on_mix_sheet: r.show_on_mix_sheet,
  }
}

export default function ServiceMappingPanel({
  initialServiceProducts, products, lineItemNames,
}: {
  initialServiceProducts: ServiceProduct[]
  products: Product[]
  lineItemNames: LineItemName[]
}) {
  const confirmDialog = useConfirm()
  const [mappings, setMappings] = useState<ServiceProduct[]>(initialServiceProducts)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const productById = useMemo(() => {
    const m = new Map<string, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])
  const productName = (id: string | null) => (id ? productById.get(id)?.name ?? '(unknown product)' : '— pick a product —')

  const flash = (msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(null), 5000) }
  async function api(url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { flash(data.error || `Request failed (${res.status})`); return null }
      return data
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Request failed'); return null
    } finally { setBusy(false) }
  }

  // ── Program picker ──
  const programOptions = useMemo(() => {
    const s = new Set<string>()
    for (const sp of mappings) if (sp.program?.trim()) s.add(sp.program.trim())
    return [...s].sort(naturalCompare)
  }, [mappings])

  const [selectedRaw, setSelected] = useState('')
  const selected = selectedRaw || programOptions[0] || UNASSIGNED

  const unassignedCount = useMemo(
    () => new Set(mappings.filter(m => !m.program?.trim()).map(m => m.jobber_line_item_name)).size,
    [mappings])

  // Line items of the selected program (rows grouped program → line item → rounds).
  const groups = useMemo<LineItemGroup[]>(() => {
    const byLine = new Map<string, ServiceProduct[]>()
    for (const sp of mappings) {
      const prog = sp.program?.trim() || UNASSIGNED
      if (prog !== selected) continue
      const arr = byLine.get(sp.jobber_line_item_name) ?? []
      arr.push(sp); byLine.set(sp.jobber_line_item_name, arr)
    }
    const out: LineItemGroup[] = []
    for (const [lineItem, rows] of byLine) {
      out.push({
        lineItem,
        program: selected === UNASSIGNED ? null : selected,
        batches: buildBatches(rows),
        // Overlaps only matter among rows the resolvers can see (active ones).
        hasOverlap: datedBatchesOverlap(rows.filter(r => r.is_active)),
      })
    }
    return out.sort((a, b) => naturalCompare(a.lineItem, b.lineItem))
  }, [mappings, selected])

  // ── Row-level actions ──
  async function addMapping(name: string, extra: Record<string, unknown>): Promise<ServiceProduct | null> {
    const n = name.trim()
    if (!n) { flash('Enter a Jobber line-item name first.'); return null }
    const d = await api('/api/admin/service-mapping/service-products', 'POST', {
      jobber_line_item_name: n, match_type: 'contains', ...extra,
    })
    if (d?.serviceProduct) {
      setMappings(prev => [...prev, d.serviceProduct as ServiceProduct])
      return d.serviceProduct as ServiceProduct
    }
    return null
  }

  async function patchMapping(id: string, patch: Partial<ServiceProduct>) {
    setMappings(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
    const d = await api(`/api/admin/service-mapping/service-products/${id}`, 'PATCH', patch)
    if (d?.serviceProduct) setMappings(prev => prev.map(m => m.id === id ? (d.serviceProduct as ServiceProduct) : m))
  }

  async function deleteMapping(sp: ServiceProduct) {
    const ok = await confirmDialog({ message: `Remove "${productName(sp.product_id)}" from "${sp.jobber_line_item_name}"?` })
    if (!ok) return
    const d = await api(`/api/admin/service-mapping/service-products/${sp.id}`, 'DELETE')
    if (d?.ok) setMappings(prev => prev.filter(m => m.id !== sp.id))
  }

  // Move a whole line item (all its rows) to a program — or clear it.
  async function assignProgram(lineItem: string, value: string) {
    const v = value.trim() || null
    const rows = mappings.filter(m => m.jobber_line_item_name === lineItem)
    if (rows.length === 0 || rows.every(r => (r.program?.trim() || null) === v)) return
    setMappings(prev => prev.map(m => m.jobber_line_item_name === lineItem ? { ...m, program: v } : m))
    await Promise.all(rows.map(r => api(`/api/admin/service-mapping/service-products/${r.id}`, 'PATCH', { program: v })))
    if (v && v !== selected) flash(`"${lineItem}" moved to ${v} — pick it in the program dropdown.`)
    if (!v && selected !== UNASSIGNED) flash(`"${lineItem}" moved to Unassigned line items.`)
  }

  // ── Round-level actions ──
  async function patchBatchMeta(
    batch: Batch,
    patch: Partial<Pick<ServiceProduct, 'effective_start' | 'effective_end' | 'batch_label'>>,
  ) {
    setMappings(prev => prev.map(m => batch.rows.some(r => r.id === m.id) ? { ...m, ...patch } : m))
    await Promise.all(batch.rows.map(r => api(`/api/admin/service-mapping/service-products/${r.id}`, 'PATCH', patch)))
  }

  async function setBatchActive(batch: Batch, active: boolean) {
    if (active && batch.placeholder) {
      flash('Set this round’s real dates first — the imported dates are placeholders (year 2000).')
      return
    }
    if (active && batch.alwaysOn) {
      const ok = await confirmDialog({ message: 'This round has no dates, so it becomes the always-on fallback mix — used whenever no dated round covers a service date. Activate anyway?' })
      if (!ok) return
    }
    setMappings(prev => prev.map(m => batch.rows.some(r => r.id === m.id) ? { ...m, is_active: active } : m))
    await Promise.all(batch.rows.map(r => api(`/api/admin/service-mapping/service-products/${r.id}`, 'PATCH', { is_active: active })))
  }

  // Clone every product of a round into a new draft starting the day after it ends.
  async function duplicateBatch(group: LineItemGroup, batch: Batch) {
    const base = batch.end ?? batch.start ?? todayInTz()
    const newStart = addDays(base, 1)
    const newLabel = batch.label ? `${batch.label} →` : 'New round'
    const rows = batch.rows.filter(r => r.product_id).map(r => ({
      jobber_line_item_name: group.lineItem, ...cloneRowFields(r),
      program: group.program, batch_label: newLabel,
      effective_start: newStart, effective_end: null, is_active: false,
    }))
    if (rows.length === 0) { flash('Nothing to duplicate — this round has no products.'); return }
    const d = await api('/api/admin/service-mapping/service-products/bulk', 'POST', { rows })
    if (!d?.serviceProducts) return
    setMappings(prev => [...prev, ...(d.serviceProducts as ServiceProduct[])])
    flash('Duplicated as a draft — set the new round’s dates, then Activate.')
  }

  async function deleteBatch(group: LineItemGroup, batch: Batch) {
    const count = batch.rows.filter(r => r.product_id).length
    const ok = await confirmDialog({ message: `Delete the round “${batch.label || (batch.alwaysOn ? 'Always-on' : 'Untitled')}” (${count} product${count === 1 ? '' : 's'}) from “${group.lineItem}”? (Soft delete — kept in the database.)` })
    if (!ok) return
    const results = await Promise.all(batch.rows.map(r =>
      api(`/api/admin/service-mapping/service-products/${r.id}`, 'DELETE').then(d => (d?.ok ? r.id : null))))
    const deleted = new Set(results.filter(Boolean))
    setMappings(prev => prev.filter(m => !deleted.has(m.id)))
  }

  // ── Add round (inline form) ──
  const [addRoundFor, setAddRoundFor] = useState<string | null>(null)
  const [newRound, setNewRound] = useState({ label: '', start: '', end: '' })

  function openAddRound(group: LineItemGroup) {
    setAddRoundFor(group.lineItem)
    setNewRound({ label: nextRoundLabel(group.batches), start: '', end: '' })
  }

  // The next free placeholder window for a line item (used when a round is
  // created without dates). Single day in year 2000 → distinct unique key,
  // never covers a real service date.
  function placeholderWindow(lineItem: string): { start: string; end: string } {
    const s = placeholderStarts(
      mappings.filter(m => m.jobber_line_item_name === lineItem).map(m => m.effective_start), 1)[0]
    return { start: s, end: s }
  }

  // Resolve a user-entered From/To pair: real window, placeholder, or an error.
  function resolveWindow(lineItem: string, from: string, to: string): { start: string; end: string | null } | null {
    if (from) return { start: from, end: to || null }
    if (to) { flash('Enter a From date too (or leave both dates blank to fill them in later).'); return null }
    return placeholderWindow(lineItem)
  }

  async function createRound(group: LineItemGroup) {
    const label = newRound.label.trim() || nextRoundLabel(group.batches)
    const win = resolveWindow(group.lineItem, newRound.start, newRound.end)
    if (!win) return
    const created = await addMapping(group.lineItem, {
      product_id: null, program: group.program, batch_label: label,
      effective_start: win.start, effective_end: win.end, is_active: false,
    })
    if (created) setAddRoundFor(null)
  }

  // ── Copy to… (inline form) ──
  const [copyFrom, setCopyFrom] = useState<string | null>(null) // source batch key
  const [copyTarget, setCopyTarget] = useState('')              // target batch key or '__new'
  const [copyNew, setCopyNew] = useState({ label: '', start: '', end: '' })

  function openCopy(batch: Batch) {
    setCopyFrom(batch.key)
    setCopyTarget('__new')
    setCopyNew({ label: batch.label ? `${batch.label} copy` : 'New round', start: '', end: '' })
  }

  async function runCopy(group: LineItemGroup, source: Batch) {
    const sourceRows = source.rows.filter(r => r.product_id)
    if (sourceRows.length === 0) { flash('Nothing to copy — this round has no products.'); return }

    let meta: { label: string | null; start: string | null; end: string | null; active: boolean }
    let skipPids = new Set<string>()
    if (copyTarget === '__new') {
      const win = resolveWindow(group.lineItem, copyNew.start, copyNew.end)
      if (!win) return
      meta = { label: copyNew.label.trim() || 'New round', start: win.start, end: win.end, active: false }
    } else {
      const target = group.batches.find(b => b.key === copyTarget)
      if (!target) { flash('Pick a round to copy into.'); return }
      meta = { label: target.label, start: target.start, end: target.end, active: !target.draft }
      skipPids = new Set(target.rows.map(r => r.product_id).filter((x): x is string => !!x))
    }

    const rows = sourceRows.filter(r => !skipPids.has(r.product_id as string)).map(r => ({
      jobber_line_item_name: group.lineItem, ...cloneRowFields(r),
      program: group.program, batch_label: meta.label,
      effective_start: meta.start, effective_end: meta.end, is_active: meta.active,
    }))
    if (rows.length === 0) { flash('Nothing to copy — that round already has all of these products.'); return }
    const d = await api('/api/admin/service-mapping/service-products/bulk', 'POST', { rows })
    if (!d?.serviceProducts) return
    setMappings(prev => [...prev, ...(d.serviceProducts as ServiceProduct[])])
    setCopyFrom(null)
    flash(`Copied ${rows.length} product${rows.length === 1 ? '' : 's'}.`)
  }

  // ── Add line item (to the selected program) ──
  const [newName, setNewName] = useState('')
  const [newProductId, setNewProductId] = useState('')

  async function addLineItem() {
    const created = await addMapping(newName, {
      product_id: newProductId || null,
      program: selected === UNASSIGNED ? null : selected,
    })
    if (created) { setNewName(''); setNewProductId('') }
  }

  // A single editable product row, shared by every round.
  function ProductRow({ sp }: { sp: ServiceProduct }) {
    return (
      <tr className="border-t border-gray-800">
        <td className="py-2 pr-3">
          <select className={`${inputCls} min-w-[160px]`} value={sp.product_id ?? ''} onChange={e => patchMapping(sp.id, { product_id: e.target.value || null })}>
            <option value="">— pick a product —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </td>
        <td className="py-2 pr-3">
          <input type="number" step="any" className={`${inputCls} w-20`} defaultValue={sp.application_rate ?? ''} placeholder="default"
            onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== sp.application_rate) patchMapping(sp.id, { application_rate: v }) }} />
        </td>
        <td className="py-2 pr-3">
          <input className={`${inputCls} w-20`} defaultValue={sp.rate_unit ?? ''} placeholder="oz/K…"
            onBlur={e => { const v = e.target.value.trim() || null; if (v !== sp.rate_unit) patchMapping(sp.id, { rate_unit: v }) }} />
        </td>
        <td className="py-2 pr-3">
          <input className={`${inputCls} w-24`} defaultValue={sp.alt_group ?? ''} placeholder="—" title="Products sharing an OR group are alternatives (use one OR the other) on the mix sheet"
            onBlur={e => { const v = e.target.value.trim() || null; if (v !== sp.alt_group) patchMapping(sp.id, { alt_group: v }) }} />
        </td>
        <td className="py-2 pr-3">
          <select className={`${inputCls} w-16`} value={sp.tank_default ?? ''} onChange={e => patchMapping(sp.id, { tank_default: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">—</option>
            {TANK_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </td>
        <td className="py-2 pr-3">
          <select className={`${inputCls} w-24`} value={sp.match_type} onChange={e => patchMapping(sp.id, { match_type: e.target.value as MatchType })}>
            {MATCH_TYPES.map(mt => <option key={mt} value={mt}>{mt}</option>)}
          </select>
        </td>
        <td className="py-2 pr-3">
          <input className={`${inputCls} w-36`} defaultValue={sp.notes ?? ''} placeholder="e.g. perimeter only"
            onBlur={e => { const v = e.target.value.trim() || null; if (v !== sp.notes) patchMapping(sp.id, { notes: v }) }} />
        </td>
        <td className="py-2 pr-3 text-center">
          <input type="checkbox" checked={sp.show_on_mix_sheet !== false} onChange={e => patchMapping(sp.id, { show_on_mix_sheet: e.target.checked })} title="Show this product on the Technician Mix Sheet (still recorded + loaded + decremented either way)" />
        </td>
        <td className="py-2 pr-3 text-center">
          <input type="checkbox" checked={sp.is_active} onChange={e => patchMapping(sp.id, { is_active: e.target.checked })} />
        </td>
        <td className="py-2 text-right">
          <button className="text-red-400 hover:text-red-300 text-xs font-semibold" disabled={busy} onClick={() => deleteMapping(sp)}>Remove</button>
        </td>
      </tr>
    )
  }

  const statusChip = (b: Batch) =>
    (b.draft || b.placeholder)
      ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-700/60 text-gray-300 border border-gray-600">Draft{b.placeholder ? ' — set dates' : ''}</span>
      : b.alwaysOn
        ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">Always-on fallback</span>
        : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Active</span>

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 max-md:pl-14">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Service Mapping</h1>
          <div className="flex gap-2">
            <Link href="/hub/admin/service-builder" className={btn}>← Service Builder</Link>
            <Link href="/hub/mix-sheet" className={btn}>Mix Sheet →</Link>
          </div>
        </div>
        <p className="text-sm text-gray-400 mb-4">Pick a program, then build its <strong className="text-gray-300">rounds</strong> — each round is the products applied for a date window, and the system uses whichever round covers each service date. Feeds the Technician Mix Sheet, Route Capacity + the Pesticide record. Draft rounds are invisible to all three until you set dates and Activate.</p>

        {notice && <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-sm">{notice}</div>}

        {/* Program picker */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <label className="text-xs text-gray-400 font-semibold">Program</label>
          <select className={`${inputCls} min-w-[220px]`} value={selected} onChange={e => setSelected(e.target.value)}>
            {programOptions.map(p => <option key={p} value={p}>{p}</option>)}
            <option value={UNASSIGNED}>Unassigned line items{unassignedCount ? ` (${unassignedCount})` : ''}</option>
          </select>
          <span className="text-xs text-gray-500">To start a new program, type its name in a line item’s Program box.</span>
        </div>
        <datalist id="program-names">
          {programOptions.map(p => <option key={p} value={p} />)}
        </datalist>
        <datalist id="line-item-names">
          {lineItemNames.map(n => <option key={n.name} value={n.name}>{`${n.uses} uses`}</option>)}
        </datalist>

        {/* Add a line item */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5">
          <h2 className="text-sm font-semibold text-gray-200 mb-3">Add a line item{selected !== UNASSIGNED ? ` to ${selected}` : ''}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs text-gray-400 mb-1">Jobber line item</label>
              <input className={`${inputCls} w-full`} list="line-item-names" placeholder="Start typing… e.g. WF - Lawn Health Basic"
                value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="min-w-[200px]">
              <label className="block text-xs text-gray-400 mb-1">First product (optional)</label>
              <select className={`${inputCls} w-full`} value={newProductId} onChange={e => setNewProductId(e.target.value)}>
                <option value="">— pick a product —</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <button className={btnPrimary} disabled={busy} onClick={addLineItem}>+ Add</button>
          </div>
          <p className="text-xs text-gray-500 mt-2">This adds an <em>always-on</em> mapping (used when no dated round covers a date). Add rounds inside the line item below.</p>
        </div>

        {groups.length === 0 ? (
          <div className="text-center text-gray-500 py-12 border border-dashed border-gray-800 rounded-xl">
            {selected === UNASSIGNED
              ? 'No unassigned line items — everything belongs to a program.'
              : 'No line items mapped for this program yet. Add one above.'}
          </div>
        ) : groups.map(group => (
          <div key={group.lineItem} className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-indigo-300">{group.lineItem}</h3>
                {group.hasOverlap && (
                  <p className="text-xs text-amber-400 mt-0.5">⚠ Two active rounds have overlapping dates — the most recently started one wins. Adjust the dates so each day maps to one round.</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Program</label>
                <input key={`${group.lineItem}|${group.program ?? ''}`} className={`${inputCls} w-44`} list="program-names"
                  defaultValue={group.program ?? ''} placeholder="e.g. Lawn Health Basic"
                  onBlur={e => assignProgram(group.lineItem, e.target.value)} />
                <button className={btn} disabled={busy} onClick={() => openAddRound(group)}>+ Add round</button>
              </div>
            </div>

            {addRoundFor === group.lineItem && (
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 mb-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Round label</label>
                  <input className={`${inputCls} w-40`} value={newRound.label} onChange={e => setNewRound(v => ({ ...v, label: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">From</label>
                  <input type="date" className={inputCls} value={newRound.start} onChange={e => setNewRound(v => ({ ...v, start: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">To</label>
                  <input type="date" className={inputCls} value={newRound.end} onChange={e => setNewRound(v => ({ ...v, end: e.target.value }))} />
                </div>
                <button className={btnPrimary} disabled={busy} onClick={() => createRound(group)}>Create draft round</button>
                <button className={btn} onClick={() => setAddRoundFor(null)}>Cancel</button>
                <p className="w-full text-xs text-gray-500 mt-1">Rounds start as drafts. You can leave the dates blank and fill them in later — real dates are required before a round can be activated.</p>
              </div>
            )}

            <div className="space-y-3">
              {group.batches.map(batch => (
                <div key={batch.key} className={`rounded-lg border p-3 ${(batch.draft || batch.placeholder) ? 'border-dashed border-gray-700/60 bg-gray-950/20' : 'border-gray-800 bg-gray-950/40'}`}>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {statusChip(batch)}
                    <input className={`${inputCls} w-40`} defaultValue={batch.label ?? ''} placeholder={batch.alwaysOn ? 'Always-on' : 'Round label'}
                      onBlur={e => { const v = e.target.value.trim() || null; if (v !== batch.label) patchBatchMeta(batch, { batch_label: v }) }} />
                    <label className="text-xs text-gray-400">From</label>
                    <input type="date" className={`${inputCls} ${batch.placeholder ? 'border-amber-500/50' : ''}`} defaultValue={batch.start ?? ''}
                      onChange={e => patchBatchMeta(batch, { effective_start: e.target.value || null })} />
                    <label className="text-xs text-gray-400">to</label>
                    <input type="date" className={`${inputCls} ${batch.placeholder ? 'border-amber-500/50' : ''}`} defaultValue={batch.end ?? ''}
                      onChange={e => patchBatchMeta(batch, { effective_end: e.target.value || null })} />
                    {batch.placeholder && <span className="text-xs text-amber-400">placeholder dates — set this year’s real window</span>}
                    {batch.alwaysOn && !batch.draft && <span className="text-xs text-gray-500">(used when no dated round covers a date)</span>}
                    <div className="ml-auto flex items-center gap-2">
                      {(batch.draft || batch.placeholder)
                        ? <button className="px-2.5 py-1 rounded-full text-xs font-semibold border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50" disabled={busy} onClick={() => setBatchActive(batch, true)} title="Make this round live — it starts feeding the Mix Sheet, Loadout and Pesticide records for its dates">Activate</button>
                        : <button className="px-2.5 py-1 rounded-full text-xs font-semibold border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50" disabled={busy} onClick={() => setBatchActive(batch, false)} title="Take this round offline (back to draft)">Deactivate</button>}
                      <button className={btn} disabled={busy} onClick={() => openCopy(batch)} title="Copy this round's products into another round">Copy to…</button>
                      {!batch.placeholder && (
                        <button className={btn} disabled={busy} onClick={() => duplicateBatch(group, batch)} title="Clone these products into a new draft round starting the day after this one ends">Duplicate →</button>
                      )}
                      <button className="text-red-400 hover:text-red-300 text-xs font-semibold" disabled={busy} onClick={() => deleteBatch(group, batch)}>Delete round</button>
                    </div>
                  </div>

                  {copyFrom === batch.key && (
                    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 mb-2 flex flex-wrap items-end gap-2">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Copy these products into</label>
                        <select className={`${inputCls} min-w-[200px]`} value={copyTarget} onChange={e => setCopyTarget(e.target.value)}>
                          <option value="__new">➕ New round…</option>
                          {group.batches.filter(b => b.key !== batch.key).map(b => (
                            <option key={b.key} value={b.key}>{b.label || (b.alwaysOn ? 'Always-on' : 'Untitled')}{b.start && !isPlaceholderDate(b.start) ? ` (${b.start}${b.end ? ` → ${b.end}` : ''})` : ''}</option>
                          ))}
                        </select>
                      </div>
                      {copyTarget === '__new' && (
                        <>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Label</label>
                            <input className={`${inputCls} w-36`} value={copyNew.label} onChange={e => setCopyNew(v => ({ ...v, label: e.target.value }))} />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">From</label>
                            <input type="date" className={inputCls} value={copyNew.start} onChange={e => setCopyNew(v => ({ ...v, start: e.target.value }))} />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">To</label>
                            <input type="date" className={inputCls} value={copyNew.end} onChange={e => setCopyNew(v => ({ ...v, end: e.target.value }))} />
                          </div>
                        </>
                      )}
                      <button className={btnPrimary} disabled={busy} onClick={() => runCopy(group, batch)}>Copy</button>
                      <button className={btn} onClick={() => setCopyFrom(null)}>Cancel</button>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500">
                          <th className="pb-2 pr-3 font-medium">Product</th>
                          <th className="pb-2 pr-3 font-medium">Rate</th>
                          <th className="pb-2 pr-3 font-medium">Unit</th>
                          <th className="pb-2 pr-3 font-medium">OR group</th>
                          <th className="pb-2 pr-3 font-medium">Tank</th>
                          <th className="pb-2 pr-3 font-medium">Match</th>
                          <th className="pb-2 pr-3 font-medium">Notes</th>
                          <th className="pb-2 pr-3 font-medium">On sheet</th>
                          <th className="pb-2 pr-3 font-medium">Active</th>
                          <th className="pb-2 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {batch.rows.map(sp => <ProductRow key={sp.id} sp={sp} />)}
                      </tbody>
                    </table>
                  </div>
                  <button className={`${btn} mt-2`} disabled={busy}
                    onClick={() => addMapping(group.lineItem, {
                      product_id: null, program: group.program, batch_label: batch.label,
                      effective_start: batch.start, effective_end: batch.end, is_active: !batch.draft,
                    })}>
                    + Add product
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
