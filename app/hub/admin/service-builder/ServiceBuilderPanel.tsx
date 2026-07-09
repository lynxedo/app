'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useConfirm } from '@/components/ui'
import type { Product } from '@/lib/products'
import { fmtMoney } from '@/lib/products'
import {
  type PriceChart, type BuilderRound, type ChartStatus,
  STATUS_LABELS, defaultBuilderSettings, productCostPerK, roundCostPerK,
  annualProductPerK, metricsAt, minutesPerK, slugifyProgramKey, pct,
  DEFAULT_LABOR_RATE, DEFAULT_MIN_LOW, DEFAULT_MIN_HIGH, DEFAULT_LABOR_THRESHOLD,
} from '@/lib/service-builder'

type SeededRound = { id: string; program: string; round_label: string | null; product_ids: string[] }

const uid = () => Math.random().toString(36).slice(2, 9)
const gpColor = (v: number) => (v >= 0.7 ? 'text-emerald-400' : v >= 0.5 ? 'text-amber-400' : 'text-red-400')
const statusChip = (s: ChartStatus) =>
  s === 'published' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  : s === 'archived' ? 'bg-gray-500/15 text-gray-400 border-gray-600/40'
  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'

export default function ServiceBuilderPanel({
  initialCharts, products, seededRounds,
}: {
  initialCharts: PriceChart[]
  products: Product[]
  seededRounds: SeededRound[]
}) {
  const confirmDialog = useConfirm()
  const [charts, setCharts] = useState<PriceChart[]>(initialCharts)
  const [activeId, setActiveId] = useState<string | null>(initialCharts[0]?.id ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const productById = useMemo(() => {
    const m = new Map(products.map(p => [p.id, p]))
    return (id: string) => m.get(id)
  }, [products])

  const active = charts.find(c => c.id === activeId) ?? null
  const galPerK = active?.builder_settings?.tankGalPerK ?? 2

  function flash(msg: string) { setError(msg); setTimeout(() => setError(''), 4500) }

  // distinct program names from Service Mapping's rounds (for "Seed rounds" + new-program suggestions)
  const seededPrograms = useMemo(() => {
    const s = new Set(seededRounds.map(r => r.program))
    return [...s].sort()
  }, [seededRounds])

  // ---- persistence: optimistic local update + debounced PATCH ----
  function patchLocal(id: string, partial: Partial<PriceChart>) {
    setCharts(prev => prev.map(c => c.id === id ? { ...c, ...partial } : c))
  }
  function patchRemote(id: string, partial: Record<string, unknown>, debounce = true) {
    const send = async () => {
      const res = await fetch(`/api/admin/service-builder/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); flash(d.error || 'Failed to save') }
      else { const { chart } = await res.json(); if (chart) patchLocal(id, chart) }
    }
    if (!debounce) { void send(); return }
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(send, 650)
  }
  // edit a field: update UI now, save shortly after
  function edit(partial: Partial<PriceChart>) {
    if (!active) return
    patchLocal(active.id, partial)
    patchRemote(active.id, partial as Record<string, unknown>)
  }

  // ---- program / version management ----
  async function createProgram() {
    const name = window.prompt('Program name (e.g. Lawn Health Complete):')?.trim()
    if (!name) return
    const version = window.prompt('Version label (e.g. 2026, or "2027 plan"):', String(new Date().getFullYear()))?.trim() || null
    setBusy(true)
    const def = defaultBuilderSettings()
    const res = await fetch('/api/admin/service-builder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_key: slugifyProgramKey(name), name, version_label: version, status: 'draft',
        visits: 8, labor_rate: 28, min_low: 2, min_high: 1.5, threshold: 15, base_fee: 50, price_per_k: 15,
        rounds: [{ id: uid(), name: 'Round 1', product_ids: [] }], builder_settings: def,
      }),
    })
    setBusy(false)
    if (res.ok) { const { chart } = await res.json(); setCharts(prev => [...prev, chart]); setActiveId(chart.id) }
    else { const d = await res.json().catch(() => ({})); flash(d.error || 'Failed to create program') }
  }

  async function duplicateVersion() {
    if (!active) return
    const version = window.prompt('Label for the new version:', `${active.version_label || ''} copy`.trim())?.trim() || null
    setBusy(true)
    const res = await fetch('/api/admin/service-builder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_key: active.program_key, name: active.name, version_label: version, status: 'draft',
        description: active.description, visits: active.visits, labor_rate: active.labor_rate,
        min_low: active.min_low, min_high: active.min_high, threshold: active.threshold,
        base_fee: active.base_fee, price_per_k: active.price_per_k,
        rounds: (active.rounds ?? []).map(r => ({ ...r, id: uid() })),
        builder_settings: active.builder_settings ?? defaultBuilderSettings(),
      }),
    })
    setBusy(false)
    if (res.ok) { const { chart } = await res.json(); setCharts(prev => [...prev, chart]); setActiveId(chart.id) }
    else { const d = await res.json().catch(() => ({})); flash(d.error || 'Failed to duplicate') }
  }

  async function renameProgram() {
    if (!active) return
    const name = window.prompt('Rename program:', active.name)?.trim()
    if (!name) return
    edit({ name })
  }
  async function editVersionLabel() {
    if (!active) return
    const v = window.prompt('Version label:', active.version_label ?? '')?.trim() ?? null
    edit({ version_label: v || null })
  }

  async function setStatus(status: ChartStatus) {
    if (!active) return
    if (status === 'published') {
      const m = metricsAt(active, active.builder_settings?.targetSize || 10, productById)
      const ok = await confirmDialog({
        message: `Publish "${active.name}${active.version_label ? ' — ' + active.version_label : ''}"?\n\nThe Pricer will quote from this version (GP ≈ ${pct(m.gp)} at ${active.builder_settings?.targetSize || 10}K). You can set an effective date below to schedule it for the future.`,
      })
      if (!ok) return
    }
    patchLocal(active.id, { status, is_published: status === 'published' })
    patchRemote(active.id, { status }, false)
  }

  async function removeVersion() {
    if (!active) return
    const ok = await confirmDialog({
      message: `Delete "${active.name}${active.version_label ? ' — ' + active.version_label : ''}"?\n\nIt's soft-deleted (kept in the database, hidden from lists). Tell Ben if you need it back.`,
      danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/admin/service-builder/${active.id}`, { method: 'DELETE' })
    if (res.ok) {
      setCharts(prev => prev.filter(c => c.id !== active.id))
      setActiveId(prev => { const rest = charts.filter(c => c.id !== active.id); return rest[0]?.id ?? null })
    } else flash('Failed to delete')
  }

  // ---- rounds ----
  function setRounds(rounds: BuilderRound[]) { edit({ rounds }) }
  function addRound() {
    if (!active) return
    setRounds([...(active.rounds ?? []), { id: uid(), name: `Round ${(active.rounds?.length ?? 0) + 1}`, product_ids: [] }])
  }
  function delRound(rid: string) {
    if (!active) return
    setRounds((active.rounds ?? []).filter(r => r.id !== rid))
  }
  function renameRound(rid: string, name: string) {
    if (!active) return
    setRounds((active.rounds ?? []).map(r => r.id === rid ? { ...r, name } : r))
  }
  function addProductToRound(rid: string, pid: string) {
    if (!active || !pid) return
    setRounds((active.rounds ?? []).map(r => r.id === rid ? { ...r, product_ids: [...r.product_ids, pid] } : r))
  }
  function removeProductFromRound(rid: string, idx: number) {
    if (!active) return
    setRounds((active.rounds ?? []).map(r => r.id === rid ? { ...r, product_ids: r.product_ids.filter((_, i) => i !== idx) } : r))
  }
  async function seedRoundsFromCurrent() {
    if (!active) return
    const matches = seededRounds.filter(r => r.program === active.name)
    if (!matches.length) { flash(`No rounds found for "${active.name}" — set them up in Service Mapping (the program name must match exactly).`); return }
    const ok = await confirmDialog({ message: `Replace this version's ${active.rounds?.length ?? 0} round(s) with the ${matches.length} seeded round(s) for "${active.name}"?` })
    if (!ok) return
    setRounds(matches.map((m, i) => ({ id: uid(), name: m.round_label || `Round ${i + 1}`, product_ids: m.product_ids })))
  }

  // ---- settings (builder_settings) ----
  function editSettings(partial: Partial<NonNullable<PriceChart['builder_settings']>>) {
    if (!active) return
    const next = { ...(active.builder_settings ?? defaultBuilderSettings()), ...partial }
    edit({ builder_settings: next })
  }

  const settings = active?.builder_settings ?? defaultBuilderSettings()
  const sizes = settings.sizes
  const annPerK = active ? annualProductPerK(active, productById, galPerK) : 0

  // averages across range
  const inRange = sizes.filter(K => K >= settings.avgMin && K <= settings.avgMax)
  const rangeMetrics = active ? inRange.map(K => metricsAt(active, K, productById)) : []
  const avg = (f: (m: ReturnType<typeof metricsAt>) => number) => rangeMetrics.length ? rangeMetrics.reduce((s, m) => s + f(m), 0) / rangeMetrics.length : 0

  // target-margin helper
  const target = (() => {
    if (!active) return null
    const tgt = (settings.targetGp || 0) / 100
    const ts = settings.targetSize || 0
    if (!(ts > 0 && tgt > 0 && tgt < 1)) return null
    const m = metricsAt(active, ts, productById)
    const neededAnnual = m.cogs / (1 - tgt)
    const neededPerVisit = (active.visits ?? 0) > 0 ? neededAnnual / (active.visits ?? 1) : 0
    const neededPerK = ts > 0 ? (neededPerVisit - (active.base_fee ?? 0)) / ts : 0
    const neededBase = neededPerVisit - (active.price_per_k ?? 0) * ts
    return { m, neededPerK, neededBase }
  })()

  // ---- render ----
  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500'
  const labelCls = 'block text-[11px] uppercase tracking-wide text-gray-500 mb-1'
  const cardCls = 'bg-gray-950/60 border border-gray-800 rounded-xl p-4'
  const btn = 'px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200'

  function Stat({ k, v, cls = '' }: { k: string; v: string; cls?: string }) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{k}</div>
        <div className={`text-xl font-bold tabular-nums mt-0.5 ${cls}`}>{v}</div>
      </div>
    )
  }

  return (
    <div className="text-white">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-semibold">Service Builder</h2>
          <p className="text-sm text-gray-400 mt-0.5">Build &amp; price a program from real product cost → COGS → margin, then publish its price chart.</p>
        </div>
        <Link href="/hub/admin/products" className="text-sm text-indigo-400 hover:text-indigo-300">Edit products →</Link>
      </div>

      {error && <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-sm">{error}</div>}

      {/* selector + actions */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <select
          value={activeId ?? ''}
          onChange={e => setActiveId(e.target.value || null)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-semibold min-w-[260px] focus:outline-none focus:border-indigo-500"
        >
          {charts.length === 0 && <option value="">No programs yet</option>}
          {charts.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}{c.version_label ? ` — ${c.version_label}` : ''} ({STATUS_LABELS[c.status]})
            </option>
          ))}
        </select>
        <button className={btn} onClick={createProgram} disabled={busy}>+ New program</button>
        {active && <button className={btn} onClick={duplicateVersion} disabled={busy}>Duplicate as version</button>}
        {active && <button className={btn} onClick={renameProgram}>Rename</button>}
        {active && <button className={`${btn} text-red-400 hover:text-red-300`} onClick={removeVersion}>Delete</button>}
      </div>

      {!active ? (
        <div className={`${cardCls} text-gray-400 text-sm`}>
          No programs yet. Click <b className="text-gray-200">+ New program</b> to start — then seed its rounds from your current composition.
        </div>
      ) : (
        <div className="space-y-4">
          {/* status bar */}
          <div className={`${cardCls} flex flex-wrap items-center gap-3`}>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${statusChip(active.status)}`}>{STATUS_LABELS[active.status]}</span>
            <button className={btn} onClick={editVersionLabel}>Version: {active.version_label || '—'}</button>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] uppercase tracking-wide text-gray-500">Effective from</label>
              <input type="date" value={active.effective_from ?? ''} onChange={e => edit({ effective_from: e.target.value || null })}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="flex-1" />
            {active.status !== 'published' && <button className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => setStatus('published')}>Publish</button>}
            {active.status === 'published' && <button className={btn} onClick={() => setStatus('draft')}>Unpublish (→ draft)</button>}
            {active.status !== 'archived' && <button className={btn} onClick={() => setStatus('archived')}>Archive</button>}
            {active.status === 'archived' && <button className={btn} onClick={() => setStatus('draft')}>Restore (→ draft)</button>}
          </div>

          {/* settings */}
          <div className={cardCls}>
            <div className="mb-3">
              <label className={labelCls}>Description</label>
              <input defaultValue={active.description ?? ''} key={`desc-${active.id}`} placeholder="e.g. LHC + Enhanced Fertilizers, Fungicides & Aeration"
                onBlur={e => { const v = e.target.value.trim() || null; if (v !== active.description) edit({ description: v }) }} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumField label="Visits / year" value={active.visits} k={active.id} onSave={v => edit({ visits: v })} />
              <NumField label="Labor rate ($/hr)" value={active.labor_rate ?? DEFAULT_LABOR_RATE} k={active.id} onSave={v => edit({ labor_rate: v })} />
              <NumField label="Min/K (small)" value={active.min_low ?? DEFAULT_MIN_LOW} k={active.id} onSave={v => edit({ min_low: v })} step="0.1" />
              <NumField label="Min/K (large)" value={active.min_high ?? DEFAULT_MIN_HIGH} k={active.id} onSave={v => edit({ min_high: v })} step="0.1" />
              <NumField label="Size threshold (K)" value={active.threshold ?? DEFAULT_LABOR_THRESHOLD} k={active.id} onSave={v => edit({ threshold: v })} />
              <NumField label="Base fee ($)" value={active.base_fee} k={active.id} onSave={v => edit({ base_fee: v })} />
              <NumField label="Price per K ($)" value={active.price_per_k} k={active.id} onSave={v => edit({ price_per_k: v })} step="0.5" />
              <NumField label="Tank gal / K" value={settings.tankGalPerK} k={active.id} onSave={v => editSettings({ tankGalPerK: v ?? 2 })} step="0.5" />
            </div>
            {(active.labor_rate == null || active.min_low == null || active.min_high == null || active.threshold == null) && (
              <p className="mt-2 text-xs text-amber-400">
                Labor not set on this program — showing Heroes standard ({DEFAULT_LABOR_RATE}/hr, {DEFAULT_MIN_LOW}/{DEFAULT_MIN_HIGH} min/K, {DEFAULT_LABOR_THRESHOLD}K threshold). Edit a value to lock it in, or Publish to save these.
              </p>
            )}
          </div>

          {/* rounds */}
          <div className={cardCls}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">Rounds &amp; products</h3>
              <span className="text-xs text-gray-500">{active.rounds?.length ?? 0} rounds · annual product {fmtMoney(annPerK)}/K</span>
              <div className="flex-1" />
              <button className={btn} onClick={seedRoundsFromCurrent}>↧ Seed from current composition</button>
              <button className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white" onClick={addRound}>+ Add round</button>
            </div>
            {(active.visits ?? 0) !== (active.rounds?.length ?? 0) && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                Heads up: <b>{active.rounds?.length ?? 0}</b> rounds defined but <b>Visits/year is {active.visits ?? 0}</b>. Annual product cost sums the rounds you define; labor &amp; per-treatment use Visits/year.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(active.rounds ?? []).map(r => (
                <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input defaultValue={r.name} key={`rn-${r.id}`} onBlur={e => { if (e.target.value !== r.name) renameRound(r.id, e.target.value) }}
                      className="bg-transparent border border-transparent hover:border-gray-700 focus:border-indigo-500 rounded px-1 py-0.5 text-sm font-bold w-28 focus:outline-none" />
                    <span className="ml-auto text-xs font-semibold text-emerald-400 tabular-nums">{fmtMoney(roundCostPerK(r, productById, galPerK))}/K</span>
                    <button className="text-gray-500 hover:text-red-400 text-sm" onClick={() => delRound(r.id)} title="Remove round">✕</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2 min-h-[6px]">
                    {r.product_ids.map((pid, idx) => {
                      const p = productById(pid)
                      const c = p ? productCostPerK(p, galPerK) : null
                      return (
                        <span key={`${pid}-${idx}`} className="inline-flex items-center gap-1 bg-gray-800 rounded-full pl-2.5 pr-1 py-0.5 text-xs">
                          {p ? p.name : '⚠ removed product'}
                          <span className="text-gray-500 tabular-nums">{c == null ? 'n/a' : fmtMoney(c)}</span>
                          <button className="w-4 h-4 inline-flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-700 hover:text-red-400" onClick={() => removeProductFromRound(r.id, idx)}>×</button>
                        </span>
                      )
                    })}
                  </div>
                  <select value="" onChange={e => { addProductToRound(r.id, e.target.value); e.target.value = '' }}
                    className="w-full bg-gray-800 border border-dashed border-gray-700 rounded px-2 py-1.5 text-xs text-gray-400 focus:outline-none focus:border-indigo-500">
                    <option value="">+ add product…</option>
                    {products.map(p => {
                      const c = productCostPerK(p, galPerK)
                      return <option key={p.id} value={p.id}>{p.name} — {c == null ? 'n/a' : fmtMoney(c)}/K</option>
                    })}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* per-K + margin cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat k="Annual product / K" v={fmtMoney(annPerK)} />
            <Stat k="Avg product / round / K" v={fmtMoney(active.rounds?.length ? annPerK / active.rounds.length : 0)} />
            <Stat k="Labor / K / visit" v={fmtMoney((minutesPerK(active, 1) / 60) * (active.labor_rate ?? DEFAULT_LABOR_RATE))} />
            <Stat k="Visits / year" v={String(active.visits ?? 0)} />
          </div>

          {/* price chart */}
          <div className={cardCls}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">Price chart by lawn size</h3>
              <div className="flex-1" />
              <label className="text-[11px] uppercase tracking-wide text-gray-500">Sizes (K)</label>
              <input defaultValue={sizes.join(', ')} key={`sizes-${active.id}`}
                onBlur={e => editSettings({ sizes: e.target.value.split(',').map(s => parseFloat(s.trim())).filter(n => isFinite(n) && n > 0) })}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-64 focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2 pr-3">Size (K)</th>
                    <th className="text-right px-2">Per-visit</th><th className="text-right px-2">Annual price</th>
                    <th className="text-right px-2">Ann. product</th><th className="text-right px-2">Ann. labor</th>
                    <th className="text-right px-2">COGS</th><th className="text-right px-2">GP margin</th>
                    <th className="text-right px-2">Product %</th><th className="text-right px-2">Labor %</th>
                    <th className="text-right pl-2">Per-treatment</th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map(K => {
                    const m = metricsAt(active, K, productById)
                    return (
                      <tr key={K} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                        <td className="text-left py-1.5 pr-3 font-bold">{K}</td>
                        <td className="text-right px-2">{fmtMoney(m.perVisit)}</td>
                        <td className="text-right px-2">{fmtMoney(m.annPrice)}</td>
                        <td className="text-right px-2 text-gray-400">{fmtMoney(m.annProduct)}</td>
                        <td className="text-right px-2 text-gray-400">{fmtMoney(m.annLabor)}</td>
                        <td className="text-right px-2 text-gray-400">{fmtMoney(m.cogs)}</td>
                        <td className={`text-right px-2 font-bold ${gpColor(m.gp)}`}>{pct(m.gp)}</td>
                        <td className="text-right px-2 text-gray-400">{pct(m.prodPct)}</td>
                        <td className="text-right px-2 text-gray-400">{pct(m.laborPct)}</td>
                        <td className="text-right pl-2">{fmtMoney(m.perTreatment)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* averages across range */}
          <div className={cardCls}>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h3 className="text-sm font-semibold">Averages across a size range</h3>
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] uppercase tracking-wide text-gray-500">From (K)</label>
                <NumInline value={settings.avgMin} k={active.id} onSave={v => editSettings({ avgMin: v ?? 0 })} />
                <label className="text-[11px] uppercase tracking-wide text-gray-500">To (K)</label>
                <NumInline value={settings.avgMax} k={active.id} onSave={v => editSettings({ avgMax: v ?? 0 })} />
              </div>
              <span className="text-xs text-gray-500">{inRange.length ? `averaging ${inRange.length} sizes: ${inRange.join(', ')} K` : ''}</span>
            </div>
            {inRange.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat k="Avg GP margin" v={pct(avg(m => m.gp))} cls={gpColor(avg(m => m.gp))} />
                <Stat k="Avg product %" v={pct(avg(m => m.prodPct))} />
                <Stat k="Avg labor %" v={pct(avg(m => m.laborPct))} />
                <Stat k="Avg annual price" v={fmtMoney(avg(m => m.annPrice))} />
              </div>
            ) : <div className="text-gray-500 text-sm">No chart sizes fall in that range.</div>}
          </div>

          {/* target-margin helper */}
          <div className={cardCls}>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h3 className="text-sm font-semibold">Target-margin helper</h3>
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] uppercase tracking-wide text-gray-500">Target GP %</label>
                <NumInline value={settings.targetGp} k={active.id} onSave={v => editSettings({ targetGp: v ?? 0 })} />
                <label className="text-[11px] uppercase tracking-wide text-gray-500">at size (K)</label>
                <NumInline value={settings.targetSize} k={active.id} onSave={v => editSettings({ targetSize: v ?? 0 })} />
              </div>
            </div>
            {target ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat k={`COGS at ${settings.targetSize}K`} v={fmtMoney(target.m.cogs)} />
                <Stat k="Current GP" v={pct(target.m.gp)} cls={gpColor(target.m.gp)} />
                <Stat k="Set Price/K to →" v={fmtMoney(target.neededPerK)} />
                <Stat k="…or set Base to →" v={fmtMoney(target.neededBase)} />
              </div>
            ) : <div className="text-gray-500 text-sm">Enter a target % (1–99) and a size.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// Labeled number input that commits on blur (keeps focus while typing).
function NumField({ label, value, onSave, k, step }: { label: string; value: number | null; onSave: (v: number | null) => void; k: string; step?: string }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</label>
      <input type="number" step={step} defaultValue={value ?? ''} key={`${k}-${label}`}
        onBlur={e => { const t = e.target.value.trim(); const n = t === '' ? null : Number(t); if (isFinite(n as number) || n === null) onSave(n) }}
        className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white text-right focus:outline-none focus:border-indigo-500" />
    </div>
  )
}

function NumInline({ value, onSave, k }: { value: number | null; onSave: (v: number | null) => void; k: string }) {
  return (
    <input type="number" defaultValue={value ?? ''} key={`${k}-${value}`}
      onBlur={e => { const t = e.target.value.trim(); const n = t === '' ? null : Number(t); if (isFinite(n as number) || n === null) onSave(n) }}
      className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white text-center focus:outline-none focus:border-indigo-500" />
  )
}
