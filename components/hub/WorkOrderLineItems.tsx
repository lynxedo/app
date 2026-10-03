'use client'

// Work Orders Phase 2 — the stop's line items, editable by the tech, sent to the
// Jobber VISIT at Complete (PRD §6). The server does the Jobber work
// (lib/work-order-line-items.ts); this is the list, the editor and the picker.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type WoItem = {
  id: string
  source: 'jobber' | 'tech_added' | 'inspection_suggested'
  status: 'proposed' | 'accepted' | 'dismissed'
  name: string
  description: string | null
  quantity: number
  unit_price: number
  orig_quantity: number | null
  orig_unit_price: number | null
  jobber_line_item_id: string | null
  sync_state: 'synced' | 'pending' | 'error'
  sync_error: string | null
  suggestion_note: string | null
}

type JobberState = {
  has_visit: boolean
  complete_pending: boolean
  completed_at: string | null
  error: string | null
  autopay: boolean | null
}

type CatalogProduct = { id: string; name: string; description: string | null; price: number; taxable: boolean | null; category: string | null }
type CatalogUsage = { productId: string; useCount: number; lastUsedAt: string | null; favorite: boolean }

const fmt = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))
const prefixOf = (name: string) => name.match(/^\s*([A-Z]{2,3})\s*-/)?.[1] ?? null
const isChanged = (li: WoItem) =>
  li.source === 'jobber' && li.orig_quantity != null && li.orig_unit_price != null &&
  (Math.abs(li.quantity - li.orig_quantity) > 0.004 || Math.abs(li.unit_price - li.orig_unit_price) > 0.004)

// One catalog read per page load — the picker opens on many stops in a day.
let catalogCache: { products: CatalogProduct[]; usage: CatalogUsage[] } | null = null

export default function WorkOrderLineItems({ stopId, stopStatus, suggestSlot }: {
  stopId: string
  stopStatus: string
  /** Part 2: the "Suggest from inspection" control, rendered under the list. */
  suggestSlot?: (reload: () => void, locked: boolean) => React.ReactNode
}) {
  const [items, setItems] = useState<WoItem[] | null>(null)
  const [locked, setLocked] = useState<string | null>(null)
  const [jobber, setJobber] = useState<JobberState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hub/work-orders/stops/${stopId}/line-items`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load line items')
      setItems(json.items)
      setLocked(json.locked)
      setJobber(json.jobber)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load line items')
    }
  }, [stopId])

  // Re-read when the stop is completed / reopened (the push changes sync state).
  useEffect(() => { void load() }, [load, stopStatus])

  async function mutate(url: string, init: RequestInit) {
    setBusy(true)
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      setItems(json.items)
      setError(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      return false
    } finally {
      setBusy(false)
    }
  }

  const base = `/api/hub/work-orders/stops/${stopId}/line-items`
  const saveItem = (id: string, patch: Record<string, unknown>) => mutate(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
  const removeItem = (id: string) => mutate(`${base}/${id}`, { method: 'DELETE' })
  const addItem = (body: Record<string, unknown>) => mutate(base, { method: 'POST', body: JSON.stringify(body) })

  const visible = useMemo(() => (items ?? []).filter(li => li.status !== 'dismissed'), [items])
  const proposed = visible.filter(li => li.status === 'proposed')
  const accepted = visible.filter(li => li.status === 'accepted')
  const total = accepted.reduce((s, li) => s + li.quantity * li.unit_price, 0)
  const deptCounts = new Map<string, number>()
  for (const li of accepted) { const p = prefixOf(li.name); if (p) deptCounts.set(p, (deptCounts.get(p) ?? 0) + 1) }
  const deptHint = [...deptCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const inJobber = !!jobber?.completed_at && stopStatus === 'complete'
  const unsent = accepted.filter(li => li.sync_state !== 'synced').length

  if (items === null && !error) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Line items</div>
        <div className="text-xs text-gray-500 px-1 py-2">Loading…</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Line items</div>
        {inJobber && <div className="text-[10px] text-emerald-400">✓ In Jobber{jobber?.autopay ? ' · autopay' : ''}</div>}
        {!inJobber && unsent > 0 && !locked && <div className="text-[10px] text-gray-400">{unsent} change{unsent === 1 ? '' : 's'} go to Jobber at Complete</div>}
      </div>

      {jobber?.error && stopStatus === 'complete' && (
        <div className="mb-2 bg-amber-900/30 border border-amber-700/50 text-amber-200 rounded px-2.5 py-2 text-xs">⚠ {jobber.error}</div>
      )}
      {error && (
        <div className="mb-2 bg-red-500/10 border border-red-500/30 text-red-200 rounded px-2.5 py-2 text-xs">{error}</div>
      )}

      {/* Suggestions waiting for the tech (Part 2) */}
      {proposed.length > 0 && (
        <div className="mb-2 rounded border border-cyan-500/30 bg-cyan-500/5 overflow-hidden">
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-cyan-300">Suggested from the inspection</div>
          {proposed.map(li => (
            <div key={li.id} className="px-2.5 py-2 border-t border-cyan-500/20 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-100">{li.name}</div>
                <div className="text-[11px] text-gray-400">
                  {fmtQty(li.quantity)} × {fmt(li.unit_price)}{li.suggestion_note ? ` · ${li.suggestion_note}` : ''}
                </div>
              </div>
              {!locked && (
                <>
                  <button type="button" disabled={busy} onClick={() => saveItem(li.id, { status: 'accepted' })}
                    className="px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs disabled:opacity-50">Add</button>
                  <button type="button" disabled={busy} onClick={() => removeItem(li.id)}
                    className="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20 text-gray-300 text-xs disabled:opacity-50" aria-label="Not needed">✕</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-gray-900/40 rounded border border-gray-800 overflow-hidden">
        {accepted.length === 0 && (
          <div className="px-2.5 py-2 text-xs text-gray-500">No line items.</div>
        )}
        {accepted.map(li => (
          editingId === li.id
            ? <ItemEditor key={li.id} item={li} busy={busy}
                onCancel={() => setEditingId(null)}
                onSave={async patch => { if (await saveItem(li.id, patch)) setEditingId(null) }}
                onRemove={async () => { if (await removeItem(li.id)) setEditingId(null) }} />
            : (
              <button key={li.id} type="button" disabled={!!locked}
                onClick={() => setEditingId(li.id)}
                className="w-full text-left px-2.5 py-2 border-b border-gray-800 last:border-b-0 flex items-start gap-2 enabled:hover:bg-white/5 disabled:cursor-default">
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${li.quantity === 0 ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{li.name}</div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {li.quantity === 0 && li.source === 'jobber' && <Tag tone="gray">Not done</Tag>}
                    {li.source === 'tech_added' && <Tag tone="indigo">Added</Tag>}
                    {li.source === 'inspection_suggested' && <Tag tone="cyan">From inspection</Tag>}
                    {isChanged(li) && li.quantity !== 0 && (
                      <Tag tone="amber">Changed · was {fmtQty(li.orig_quantity ?? 0)} × {fmt(li.orig_unit_price ?? 0)}</Tag>
                    )}
                    {li.sync_state === 'error' && <Tag tone="red" title={li.sync_error ?? undefined}>⚠ Not in Jobber yet</Tag>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm text-gray-100">{fmt(li.quantity * li.unit_price)}</div>
                  <div className="text-[11px] text-gray-500">{fmtQty(li.quantity)} × {fmt(li.unit_price)}</div>
                </div>
              </button>
            )
        ))}
        {accepted.length > 0 && (
          <div className="px-2.5 py-1.5 bg-gray-900/60 flex justify-between text-xs">
            <span className="text-gray-400 uppercase tracking-wide text-[10px] self-center">Total</span>
            <span className="text-white font-medium">{fmt(total)}</span>
          </div>
        )}
      </div>

      {!locked && (
        <button type="button" onClick={() => setPickerOpen(true)}
          className="mt-2 w-full py-2 rounded border border-dashed border-gray-700 text-sm text-gray-300 hover:bg-white/5">
          + Add line item
        </button>
      )}
      {locked && stopStatus === 'complete' && (
        <div className="mt-1 text-[11px] text-gray-500">Reopen the stop to change line items.</div>
      )}

      {suggestSlot?.(() => { void load() }, !!locked)}

      {pickerOpen && (
        <CatalogPicker deptHint={deptHint} busy={busy}
          onClose={() => setPickerOpen(false)}
          onAdd={async body => { if (await addItem(body)) setPickerOpen(false) }} />
      )}
    </div>
  )
}

function Tag({ children, tone, title }: { children: React.ReactNode; tone: 'gray' | 'indigo' | 'cyan' | 'amber' | 'red'; title?: string }) {
  const tones = {
    gray: 'bg-white/10 text-gray-300',
    indigo: 'bg-indigo-500/20 text-indigo-200',
    cyan: 'bg-cyan-500/20 text-cyan-200',
    amber: 'bg-amber-500/20 text-amber-200',
    red: 'bg-red-500/20 text-red-200',
  }
  return <span title={title} className={`text-[10px] px-1.5 py-0.5 rounded ${tones[tone]}`}>{children}</span>
}

function ItemEditor({ item, busy, onSave, onCancel, onRemove }: {
  item: WoItem
  busy: boolean
  onSave: (patch: { quantity: number; unitPrice: number }) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const [qty, setQty] = useState(String(item.quantity))
  const [price, setPrice] = useState(String(item.unit_price))
  const q = Number(qty)
  const p = Number(price)
  const valid = Number.isFinite(q) && q >= 0 && Number.isFinite(p) && p >= 0
  const inJobber = item.source === 'jobber' || !!item.jobber_line_item_id
  return (
    <div className="px-2.5 py-2.5 border-b border-gray-800 last:border-b-0 bg-white/5 space-y-2">
      <div className="text-sm text-gray-100">{item.name}</div>
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Qty</span>
          <div className="flex items-center">
            <button type="button" onClick={() => setQty(String(Math.max(0, (Number(qty) || 0) - 1)))}
              className="w-9 h-9 rounded-l bg-white/10 text-white text-lg">−</button>
            <input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)}
              className="w-14 h-9 bg-gray-900 border-y border-gray-700 text-center text-sm text-white" />
            <button type="button" onClick={() => setQty(String((Number(qty) || 0) + 1))}
              className="w-9 h-9 rounded-r bg-white/10 text-white text-lg">+</button>
          </div>
        </label>
        <label className="flex-1">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Price each</span>
          <div className="flex items-center h-9 bg-gray-900 border border-gray-700 rounded px-2">
            <span className="text-gray-500 text-sm">$</span>
            <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)}
              className="w-full bg-transparent text-sm text-white pl-1 outline-none" />
          </div>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !valid} onClick={() => onSave({ quantity: q, unitPrice: p })}
          className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs disabled:opacity-50">Save</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-gray-200 text-xs">Cancel</button>
        <div className="flex-1" />
        <button type="button" disabled={busy} onClick={onRemove}
          className="px-3 py-1.5 rounded bg-red-500/15 hover:bg-red-500/25 text-red-200 text-xs disabled:opacity-50">
          {inJobber ? 'Not done' : 'Remove'}
        </button>
      </div>
    </div>
  )
}

function CatalogPicker({ deptHint, busy, onClose, onAdd }: {
  deptHint: string | null
  busy: boolean
  onClose: () => void
  onAdd: (body: Record<string, unknown>) => void
}) {
  const [catalog, setCatalog] = useState(catalogCache)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState<string>(deptHint ?? 'All')
  const [picked, setPicked] = useState<CatalogProduct | null>(null)
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (catalogCache) return
    fetch('/api/hub/work-orders/catalog', { cache: 'no-store' })
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? 'Could not load the catalog')
        catalogCache = j
        setCatalog(j)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load the catalog'))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const usage = useMemo(() => new Map((catalog?.usage ?? []).map(u => [u.productId, u])), [catalog])
  const prefixes = useMemo(() => {
    const s = new Set<string>()
    for (const p of catalog?.products ?? []) { const x = prefixOf(p.name); if (x) s.add(x) }
    return [...s].sort()
  }, [catalog])

  const list = useMemo(() => {
    const all = catalog?.products ?? []
    const q = search.trim().toLowerCase()
    if (q) return all.filter(p => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
    if (chip === '★') return all.filter(p => usage.get(p.id)?.favorite)
    if (chip === 'Recent') {
      return all.filter(p => usage.get(p.id)?.lastUsedAt)
        .sort((a, b) => (usage.get(b.id)?.lastUsedAt ?? '').localeCompare(usage.get(a.id)?.lastUsedAt ?? ''))
        .slice(0, 20)
    }
    const inChip = chip === 'All' ? all : all.filter(p => prefixOf(p.name) === chip)
    // Favorites, then most used, then A–Z.
    return [...inChip].sort((a, b) => {
      const ua = usage.get(a.id), ub = usage.get(b.id)
      if (!!ub?.favorite !== !!ua?.favorite) return ub?.favorite ? 1 : -1
      if ((ub?.useCount ?? 0) !== (ua?.useCount ?? 0)) return (ub?.useCount ?? 0) - (ua?.useCount ?? 0)
      return a.name.localeCompare(b.name)
    })
  }, [catalog, search, chip, usage])

  async function toggleFavorite(p: CatalogProduct) {
    const fav = !usage.get(p.id)?.favorite
    const next = { products: catalog!.products, usage: [...(catalog!.usage.filter(u => u.productId !== p.id)), { ...(usage.get(p.id) ?? { productId: p.id, useCount: 0, lastUsedAt: null }), favorite: fav }] }
    catalogCache = next
    setCatalog(next)
    await fetch('/api/hub/work-orders/catalog', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: p.id, name: p.name, favorite: fav }),
    }).catch(() => {})
  }

  function pick(p: CatalogProduct) {
    setPicked(p)
    setQty('1')
    setPrice(String(p.price ?? 0))
  }

  function confirmAdd() {
    if (!picked) return
    const q = Number(qty), pr = Number(price)
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(pr) || pr < 0) return
    // Count it as a recent pick locally so the list updates without a reload.
    if (catalogCache) {
      const u = usage.get(picked.id)
      catalogCache = { products: catalogCache.products, usage: [...catalogCache.usage.filter(x => x.productId !== picked.id),
        { productId: picked.id, useCount: (u?.useCount ?? 0) + 1, lastUsedAt: new Date().toISOString(), favorite: !!u?.favorite }] }
    }
    onAdd({ name: picked.name, description: picked.description, quantity: q, unitPrice: pr, taxable: picked.taxable, jobberProductId: picked.id })
  }

  const chips = ['★', 'Recent', ...prefixes, 'All']

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full sm:max-w-lg h-[85vh] sm:h-[75vh] bg-gray-950 border border-gray-800 rounded-t-xl sm:rounded-xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800">
          <div className="flex-1 text-sm font-medium text-white">{picked ? 'Add line item' : 'Pick a line item'}</div>
          <button type="button" onClick={picked ? () => setPicked(null) : onClose} className="text-gray-400 hover:text-white text-sm px-2 py-1">
            {picked ? '‹ Back' : 'Close'}
          </button>
        </div>

        {picked ? (
          <div className="p-3 space-y-3">
            <div>
              <div className="text-base text-white">{picked.name}</div>
              {picked.description && <div className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{picked.description}</div>}
            </div>
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Qty</span>
                <div className="flex items-center">
                  <button type="button" onClick={() => setQty(String(Math.max(1, (Number(qty) || 1) - 1)))} className="w-10 h-10 rounded-l bg-white/10 text-white text-lg">−</button>
                  <input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} className="w-14 h-10 bg-gray-900 border-y border-gray-700 text-center text-white" />
                  <button type="button" onClick={() => setQty(String((Number(qty) || 0) + 1))} className="w-10 h-10 rounded-r bg-white/10 text-white text-lg">+</button>
                </div>
              </label>
              <label className="flex-1">
                <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Price each</span>
                <div className="flex items-center h-10 bg-gray-900 border border-gray-700 rounded px-2">
                  <span className="text-gray-500">$</span>
                  <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} className="w-full bg-transparent text-white pl-1 outline-none" />
                </div>
              </label>
            </div>
            <div className="text-sm text-gray-300">Total {fmt((Number(qty) || 0) * (Number(price) || 0))}</div>
            <button type="button" disabled={busy} onClick={confirmAdd}
              className="w-full py-2.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
              {busy ? 'Adding…' : 'Add to work order'}
            </button>
          </div>
        ) : (
          <>
            <div className="px-3 pt-2.5 space-y-2">
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the catalog…"
                className="w-full h-10 px-3 rounded bg-gray-900 border border-gray-700 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500" />
              {!search && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {chips.map(c => (
                    <button key={c} type="button" onClick={() => setChip(c)}
                      className={`shrink-0 px-2.5 py-1 rounded-full text-xs ${chip === c ? 'bg-indigo-600 text-white' : 'bg-white/10 text-gray-300'}`}>
                      {c === '★' ? '★ Favorites' : c}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto mt-1">
              {error && <div className="px-3 py-3 text-sm text-red-300">{error}</div>}
              {!catalog && !error && <div className="px-3 py-3 text-sm text-gray-500">Loading the Jobber catalog…</div>}
              {catalog && list.length === 0 && (
                <div className="px-3 py-3 text-sm text-gray-500">
                  {chip === '★' && !search ? 'No favorites yet — tap ☆ on an item to keep it here.' : chip === 'Recent' && !search ? 'Nothing added yet.' : 'No matches.'}
                </div>
              )}
              {list.map(p => (
                <div key={p.id} className="flex items-center border-b border-gray-900">
                  <button type="button" onClick={() => pick(p)} className="flex-1 min-w-0 text-left px-3 py-2.5 hover:bg-white/5">
                    <div className="text-sm text-gray-100 truncate">{p.name}</div>
                    <div className="text-[11px] text-gray-500">{fmt(p.price ?? 0)}</div>
                  </button>
                  <button type="button" onClick={() => toggleFavorite(p)} aria-label={usage.get(p.id)?.favorite ? 'Unfavorite' : 'Favorite'}
                    className={`px-3 py-2.5 text-lg ${usage.get(p.id)?.favorite ? 'text-amber-300' : 'text-gray-600 hover:text-gray-400'}`}>
                    {usage.get(p.id)?.favorite ? '★' : '☆'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
