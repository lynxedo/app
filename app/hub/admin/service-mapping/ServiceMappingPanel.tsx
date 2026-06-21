'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useConfirm } from '@/components/ui'
import type { Product } from '@/lib/products'
import {
  type ServiceProduct, type ProductRound, type LineItemName,
  type MatchType, MATCH_TYPES, TANK_OPTIONS,
} from '@/lib/service-mapping'

const inputCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500'
const btn = 'px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50'
const btnPrimary = 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'

type Tab = 'mapping' | 'rounds'

export default function ServiceMappingPanel({
  initialServiceProducts, initialRounds, products, lineItemNames,
}: {
  initialServiceProducts: ServiceProduct[]
  initialRounds: ProductRound[]
  products: Product[]
  lineItemNames: LineItemName[]
}) {
  const confirmDialog = useConfirm()
  const [tab, setTab] = useState<Tab>('mapping')
  const [mappings, setMappings] = useState<ServiceProduct[]>(initialServiceProducts)
  const [rounds, setRounds] = useState<ProductRound[]>(initialRounds)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const productById = useMemo(() => {
    const m = new Map<string, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])
  const productName = (id: string | null) => (id ? productById.get(id)?.name ?? '(unknown product)' : '— pick a product —')

  const flash = (msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(null), 4000) }
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

  // ── Mapping tab state ──
  const [newName, setNewName] = useState('')
  const [newProductId, setNewProductId] = useState('')

  const mappingGroups = useMemo(() => {
    const m = new Map<string, ServiceProduct[]>()
    for (const sp of mappings) {
      const arr = m.get(sp.jobber_line_item_name) ?? []
      arr.push(sp); m.set(sp.jobber_line_item_name, arr)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [mappings])

  async function addMapping(name: string, productId: string | null) {
    const n = name.trim()
    if (!n) { flash('Enter a Jobber line-item name first.'); return }
    const d = await api('/api/admin/service-mapping/service-products', 'POST', {
      jobber_line_item_name: n, product_id: productId || null, match_type: 'contains',
    })
    if (d?.serviceProduct) {
      setMappings(prev => [...prev, d.serviceProduct as ServiceProduct])
      setNewName(''); setNewProductId('')
    }
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

  // ── Rounds tab ──
  const roundGroups = useMemo(() => {
    const m = new Map<string, ProductRound[]>()
    for (const r of rounds) {
      const arr = m.get(r.program) ?? []
      arr.push(r); m.set(r.program, arr)
    }
    return [...m.entries()]
      .map(([program, rs]) => [program, rs.sort((a, b) => (a.round_label ?? '').localeCompare(b.round_label ?? ''))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [rounds])

  async function patchRound(id: string, patch: Partial<ProductRound>) {
    setRounds(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    const d = await api(`/api/admin/service-mapping/product-rounds/${id}`, 'PATCH', patch)
    if (d?.round) setRounds(prev => prev.map(r => r.id === id ? (d.round as ProductRound) : r))
  }

  async function setCurrent(round: ProductRound, makeCurrent: boolean) {
    const d = await api(`/api/admin/service-mapping/product-rounds/${round.id}/set-current`, 'POST', { current: makeCurrent })
    if (d?.ok) {
      setRounds(prev => prev.map(r =>
        r.program !== round.program ? r : { ...r, is_current: makeCurrent && r.id === round.id }))
    }
  }

  async function addRound(program: string) {
    const label = window.prompt(`New round for "${program}" — label:`, '')?.trim()
    if (label === undefined) return
    const d = await api('/api/admin/service-mapping/product-rounds', 'POST', { program, round_label: label || null, product_ids: [] })
    if (d?.round) setRounds(prev => [...prev, d.round as ProductRound])
  }

  async function deleteRound(r: ProductRound) {
    const ok = await confirmDialog({ message: `Delete round "${r.round_label || 'Untitled'}" from "${r.program}"? (Soft delete — kept in the database.)` })
    if (!ok) return
    const d = await api(`/api/admin/service-mapping/product-rounds/${r.id}`, 'DELETE')
    if (d?.ok) setRounds(prev => prev.filter(x => x.id !== r.id))
  }

  function addProductToRound(r: ProductRound, productId: string) {
    if (!productId || r.product_ids.includes(productId)) return
    patchRound(r.id, { product_ids: [...r.product_ids, productId] })
  }
  function removeProductFromRound(r: ProductRound, productId: string) {
    patchRound(r.id, { product_ids: r.product_ids.filter(id => id !== productId) })
  }

  const tabCls = (t: Tab) => `px-3.5 py-2 text-sm font-semibold rounded-lg ${tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 max-md:pl-14">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Service Mapping</h1>
          <Link href="/hub/admin/service-builder" className={btn}>← Service Builder</Link>
        </div>
        <p className="text-sm text-gray-400 mb-4">Tie Jobber line items to products, and pick the active round for each program. Feeds Route Capacity + the Pesticide record.</p>

        {notice && <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-sm">{notice}</div>}

        <div className="flex gap-2 mb-5">
          <button className={tabCls('mapping')} onClick={() => setTab('mapping')}>Line-Item Map</button>
          <button className={tabCls('rounds')} onClick={() => setTab('rounds')}>Current Rounds</button>
        </div>

        {tab === 'mapping' ? (
          <>
            {/* Add a mapping */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5">
              <h2 className="text-sm font-semibold text-gray-200 mb-3">Add a mapping</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[240px]">
                  <label className="block text-xs text-gray-400 mb-1">Jobber line item</label>
                  <input className={`${inputCls} w-full`} list="line-item-names" placeholder="Start typing… e.g. WF - Lawn Health Basic"
                    value={newName} onChange={e => setNewName(e.target.value)} />
                  <datalist id="line-item-names">
                    {lineItemNames.map(n => <option key={n.name} value={n.name}>{`${n.uses} uses`}</option>)}
                  </datalist>
                </div>
                <div className="min-w-[200px]">
                  <label className="block text-xs text-gray-400 mb-1">Product</label>
                  <select className={`${inputCls} w-full`} value={newProductId} onChange={e => setNewProductId(e.target.value)}>
                    <option value="">— pick a product —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <button className={btnPrimary} disabled={busy} onClick={() => addMapping(newName, newProductId)}>+ Add</button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Tip: a line item can map to several products — add each one. The line-item field suggests real Jobber names with their usage counts.</p>
            </div>

            {mappingGroups.length === 0 ? (
              <div className="text-center text-gray-500 py-12 border border-dashed border-gray-800 rounded-xl">No mappings yet. Add one above.</div>
            ) : mappingGroups.map(([name, rows]) => (
              <div key={name} className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="font-semibold text-indigo-300">{name}</h3>
                  <button className={btn} disabled={busy} onClick={() => addMapping(name, null)}>+ Add product</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="pb-2 pr-3 font-medium">Product</th>
                        <th className="pb-2 pr-3 font-medium">Rate</th>
                        <th className="pb-2 pr-3 font-medium">Unit</th>
                        <th className="pb-2 pr-3 font-medium">Program</th>
                        <th className="pb-2 pr-3 font-medium">Tank</th>
                        <th className="pb-2 pr-3 font-medium">Match</th>
                        <th className="pb-2 pr-3 font-medium">Notes</th>
                        <th className="pb-2 pr-3 font-medium">Active</th>
                        <th className="pb-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(sp => (
                        <tr key={sp.id} className="border-t border-gray-800">
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
                            <input className={`${inputCls} w-32`} defaultValue={sp.program ?? ''} placeholder="program"
                              onBlur={e => { const v = e.target.value.trim() || null; if (v !== sp.program) patchMapping(sp.id, { program: v }) }} />
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
                            <input type="checkbox" checked={sp.is_active} onChange={e => patchMapping(sp.id, { is_active: e.target.checked })} />
                          </td>
                          <td className="py-2 text-right">
                            <button className="text-red-400 hover:text-red-300 text-xs font-semibold" disabled={busy} onClick={() => deleteMapping(sp)}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {roundGroups.length === 0 ? (
              <div className="text-center text-gray-500 py-12 border border-dashed border-gray-800 rounded-xl">No program rounds yet.</div>
            ) : roundGroups.map(([program, programRounds]) => {
              const current = programRounds.find(r => r.is_current)
              return (
                <div key={program} className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <h3 className="font-semibold text-indigo-300">{program}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {current ? <>Active round: <span className="text-emerald-300 font-medium">{current.round_label || 'Untitled'}</span></> : <span className="text-amber-400">No active round set</span>}
                      </p>
                    </div>
                    <button className={btn} disabled={busy} onClick={() => addRound(program)}>+ Add round</button>
                  </div>
                  <div className="space-y-3">
                    {programRounds.map(r => (
                      <div key={r.id} className={`rounded-lg border p-3 ${r.is_current ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-gray-800 bg-gray-950/40'}`}>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <button
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${r.is_current ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-gray-600 text-gray-300 hover:bg-gray-800'}`}
                            disabled={busy}
                            onClick={() => setCurrent(r, !r.is_current)}
                            title={r.is_current ? 'Click to clear the active round' : 'Make this the active round'}
                          >
                            {r.is_current ? '✓ Active round' : 'Make current'}
                          </button>
                          <input className={`${inputCls} flex-1 min-w-[180px]`} defaultValue={r.round_label ?? ''} placeholder="Round label (e.g. Round 3 — Spring 2026)"
                            onBlur={e => { const v = e.target.value.trim() || null; if (v !== r.round_label) patchRound(r.id, { round_label: v }) }} />
                          <label className="text-xs text-gray-400">Effective</label>
                          <input type="date" className={inputCls} defaultValue={r.effective_from ?? ''}
                            onChange={e => patchRound(r.id, { effective_from: e.target.value || null })} />
                          <button className="text-red-400 hover:text-red-300 text-xs font-semibold ml-auto" disabled={busy} onClick={() => deleteRound(r)}>Delete</button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.product_ids.length === 0 && <span className="text-xs text-gray-600 italic">No products yet</span>}
                          {r.product_ids.map(pid => (
                            <span key={pid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-200">
                              {productName(pid)}
                              <button className="text-gray-500 hover:text-red-300" disabled={busy} onClick={() => removeProductFromRound(r, pid)} aria-label="Remove">×</button>
                            </span>
                          ))}
                          <select className={`${inputCls} w-auto`} value="" onChange={e => { addProductToRound(r, e.target.value); e.currentTarget.selectedIndex = 0 }}>
                            <option value="">+ add product…</option>
                            {products.filter(p => !r.product_ids.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
