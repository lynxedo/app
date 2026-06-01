'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  type Product, type ProductVariant, type ProductLocationInventory,
  type ProductCategory, type InventoryLocation, type RateBasis,
  RATE_BASIS_LABELS, costPer1000, ksfPerPackage, inventoryTotal, inventoryValue,
  fmtMoney, fmtNum,
} from '@/lib/products'

// The loaded item carries its sub-items + per-location inventory inline (Supabase nested select).
type Item = Product & {
  product_variants: ProductVariant[]
  product_location_inventory: ProductLocationInventory[]
}

const UNIT_OPTIONS = ['lbs', 'oz', 'fl oz', 'g', 'gal', 'each']
const RATE_BASIS_ORDER: RateBasis[] = ['per_1000sqft', 'per_gallon', 'per_tree', 'other']

function costSuffix(basis: RateBasis): string {
  if (basis === 'per_1000sqft') return ' /1k'
  if (basis === 'per_gallon') return ' /gal'
  if (basis === 'per_tree') return ' /tree'
  return ''
}

function sortedVariants(item: Item): ProductVariant[] {
  return [...item.product_variants].sort(
    (a, b) => (a.sort_order - b.sort_order) || (a.label ?? '').localeCompare(b.label ?? ''),
  )
}

// Collapsed-row cost summary: single variant → exact; multiple → range across the dominant basis.
function itemCostSummary(item: Item): string | null {
  const vs = item.product_variants.filter(v => v.is_active)
  if (vs.length === 0) return null
  if (vs.length === 1) {
    const c = costPer1000(item.package_price, item.package_size, vs[0].application_rate)
    return c == null ? null : fmtMoney(c) + costSuffix(vs[0].rate_basis)
  }
  const basisGroup = vs.some(v => v.rate_basis === 'per_1000sqft')
    ? vs.filter(v => v.rate_basis === 'per_1000sqft')
    : vs
  const costs = basisGroup
    .map(v => costPer1000(item.package_price, item.package_size, v.application_rate))
    .filter((c): c is number => c != null)
  if (!costs.length) return null
  const min = Math.min(...costs), max = Math.max(...costs)
  const suffix = costSuffix(basisGroup[0].rate_basis)
  return min === max ? fmtMoney(min) + suffix : `${fmtMoney(min)}–${fmtMoney(max)}${suffix}`
}

// ---------------------------------------------------------------------------
// Inline-editable number cell (used for package price + per-location quantity).
// ---------------------------------------------------------------------------
function NumberCell({
  value, onSave, placeholder = '', prefix = '', className = '', width = 'w-20',
}: {
  value: number | null
  onSave: (v: number | null) => void
  placeholder?: string
  prefix?: string
  className?: string
  width?: string
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => { setText(value == null ? '' : String(value)) }, [value])

  function commit() {
    const t = text.trim()
    const num = t === '' ? null : Number(t)
    if (t !== '' && !isFinite(num as number)) { setText(value == null ? '' : String(value)); return }
    if (num !== value) onSave(num)
  }

  return (
    <div className="inline-flex items-center">
      {prefix && <span className="text-gray-500 text-xs mr-0.5">{prefix}</span>}
      <input
        value={text}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`${width} bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white text-right placeholder-gray-600 focus:outline-none focus:border-indigo-500 ${className}`}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-items (rates) manager — shown in an expanded item panel.
// ---------------------------------------------------------------------------
function VariantManager({
  item, onChange, onError,
}: {
  item: Item
  onChange: (variants: ProductVariant[]) => void
  onError: (msg: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [rate, setRate] = useState('')
  const [basis, setBasis] = useState<RateBasis>('per_1000sqft')
  const [busy, setBusy] = useState(false)

  async function addVariant() {
    setBusy(true)
    const res = await fetch('/api/admin/product-variants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: item.id,
        label: label.trim() || null,
        application_rate: rate.trim() === '' ? null : Number(rate),
        rate_basis: basis,
      }),
    })
    setBusy(false)
    if (res.ok) {
      const { variant } = await res.json()
      onChange([...item.product_variants, variant])
      setLabel(''); setRate(''); setBasis('per_1000sqft'); setAdding(false)
    } else {
      const d = await res.json().catch(() => ({}))
      onError(d.error || 'Failed to add sub-item')
    }
  }

  async function saveVariant(id: string, patch: Partial<ProductVariant>) {
    const res = await fetch(`/api/admin/product-variants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) {
      const { variant } = await res.json()
      onChange(item.product_variants.map(v => v.id === id ? variant : v))
    } else {
      const d = await res.json().catch(() => ({}))
      onError(d.error || 'Failed to save sub-item')
    }
  }

  async function deleteVariant(id: string) {
    if (!confirm('Delete this sub-item (rate)?')) return
    const res = await fetch(`/api/admin/product-variants/${id}`, { method: 'DELETE' })
    if (res.ok) onChange(item.product_variants.filter(v => v.id !== id))
    else onError('Failed to delete sub-item')
  }

  const vs = sortedVariants(item)

  return (
    <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-200">Sub-items (rates)</h4>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-indigo-400 hover:text-indigo-300 text-xs font-medium">
            + Add sub-item
          </button>
        )}
      </div>

      {vs.length === 0 && !adding && (
        <p className="text-gray-600 text-sm italic mb-2">No rates yet — add one so the routing tool and pesticide records have a rate to use.</p>
      )}

      {vs.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {vs.map(v => {
            const cost = costPer1000(item.package_price, item.package_size, v.application_rate)
            const ksf = ksfPerPackage(item.package_size, v.application_rate)
            return (
              <div key={v.id} className="flex items-center gap-2 flex-wrap bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
                <input
                  defaultValue={v.label ?? ''}
                  placeholder="label (e.g. High Rate)"
                  onBlur={e => { const val = e.target.value.trim() || null; if (val !== v.label) saveVariant(v.id, { label: val }) }}
                  className="flex-1 min-w-[140px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">rate</span>
                  <NumberCell
                    value={v.application_rate}
                    width="w-16"
                    onSave={n => saveVariant(v.id, { application_rate: n })}
                  />
                  <span className="text-xs text-gray-500">{item.unit || '?'}</span>
                </div>
                <select
                  value={v.rate_basis}
                  onChange={e => saveVariant(v.id, { rate_basis: e.target.value as RateBasis })}
                  className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
                >
                  {RATE_BASIS_ORDER.map(b => <option key={b} value={b}>{RATE_BASIS_LABELS[b]}</option>)}
                </select>
                <span className="text-xs text-gray-400 whitespace-nowrap w-28 text-right" title="Derived cost per 1,000 sq ft">
                  {cost == null ? '—' : fmtMoney(cost) + costSuffix(v.rate_basis)}
                  {ksf != null && <span className="text-gray-600"> · {fmtNum(ksf, 1)} Ksf/pkg</span>}
                </span>
                <button onClick={() => deleteVariant(v.id)} className="text-gray-600 hover:text-red-400 text-sm" title="Delete sub-item">✕</button>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <div className="flex items-end gap-2 flex-wrap bg-gray-900 border border-indigo-700/40 rounded-lg px-3 py-2 mt-1">
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. High Rate"
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Rate ({item.unit || '?'})</label>
            <input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" placeholder="0"
              className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white text-right placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Basis</label>
            <select value={basis} onChange={e => setBasis(e.target.value as RateBasis)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-indigo-500">
              {RATE_BASIS_ORDER.map(b => <option key={b} value={b}>{RATE_BASIS_LABELS[b]}</option>)}
            </select>
          </div>
          <button onClick={addVariant} disabled={busy} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded">Add</button>
          <button onClick={() => { setAdding(false); setLabel(''); setRate('') }} className="text-gray-500 hover:text-gray-300 text-sm px-2 py-1.5">Cancel</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expanded item editor — all the item-level fields.
// ---------------------------------------------------------------------------
function ItemEditor({
  item, categories, onSaveField, onError,
}: {
  item: Item
  categories: ProductCategory[]
  onSaveField: (field: string, value: unknown) => void
  onError: (msg: string) => void
}) {
  function txt(field: keyof Item, label: string, opts: { placeholder?: string; full?: boolean } = {}) {
    return (
      <div className={opts.full ? 'sm:col-span-2' : ''}>
        <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</label>
        <input
          defaultValue={(item[field] as string) ?? ''}
          placeholder={opts.placeholder}
          onBlur={e => { const v = e.target.value.trim() || null; if (v !== (item[field] ?? null)) onSaveField(field as string, v) }}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        />
      </div>
    )
  }

  return (
    <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-4 mb-3">
      <h4 className="text-sm font-semibold text-gray-200 mb-3">Item details</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {txt('name', 'Name', { placeholder: 'Product name' })}
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Group</label>
          <select
            value={item.category_id ?? ''}
            onChange={e => onSaveField('category_id', e.target.value || null)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Uncategorized</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {txt('description', 'Description', { placeholder: 'e.g. granular, slow-release', full: true })}
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Package price</label>
          <NumberCell value={item.package_price} prefix="$" width="w-full" onSave={n => onSaveField('package_price', n)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Package size</label>
            <NumberCell value={item.package_size} width="w-full" onSave={n => onSaveField('package_size', n)} />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Unit</label>
            <input
              defaultValue={item.unit ?? ''}
              list="product-unit-options"
              placeholder="lbs"
              onBlur={e => { const v = e.target.value.trim() || null; if (v !== item.unit) onSaveField('unit', v) }}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        {txt('epa_reg_number', 'EPA Reg #', { placeholder: '279-3206' })}
        {txt('active_ingredient', 'Active ingredient', { placeholder: 'Bifenthrin 7.9%' })}
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Batch #</label>
          <input
            defaultValue={item.batch_number ?? ''}
            onBlur={e => { const v = e.target.value.trim() || null; if (v !== item.batch_number) onSaveField('batch_number', v) }}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Batch date</label>
          <input
            type="date"
            defaultValue={item.batch_date ?? ''}
            onBlur={e => { const v = e.target.value || null; if (v !== item.batch_date) onSaveField('batch_date', v) }}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        {txt('notes', 'Notes', { full: true })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings — manage groups + locations (Tracker ListEditor pattern, persisted).
// ---------------------------------------------------------------------------
function EntityList({
  title, hint, noun, items, endpoint, deleteWarning, onChange, onError,
}: {
  title: string
  hint: string
  noun: string
  items: { id: string; name: string; sort_order: number }[]
  endpoint: string
  deleteWarning: string
  onChange: (items: { id: string; name: string; sort_order: number }[]) => void
  onError: (msg: string) => void
}) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sort_order: items.length }),
    })
    setBusy(false)
    if (res.ok) {
      const data = await res.json()
      const row = data.category ?? data.location
      onChange([...items, row])
      setNewName('')
    } else {
      const d = await res.json().catch(() => ({}))
      onError(d.error || `Failed to add ${noun}`)
    }
  }

  async function rename(id: string, name: string) {
    const res = await fetch(`${endpoint}/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      const data = await res.json()
      const row = data.category ?? data.location
      onChange(items.map(i => i.id === id ? row : i))
    } else {
      const d = await res.json().catch(() => ({}))
      onError(d.error || `Failed to rename ${noun}`)
    }
  }

  async function remove(id: string) {
    if (!confirm(deleteWarning)) return
    const res = await fetch(`${endpoint}/${id}`, { method: 'DELETE' })
    if (res.ok) onChange(items.filter(i => i.id !== id))
    else onError(`Failed to delete ${noun}`)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="font-semibold text-white mb-1">{title}</h3>
      <p className="text-xs text-gray-500 mb-4">{hint}</p>
      <div className="space-y-1.5 mb-4">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-2">
            <input
              defaultValue={item.name}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== item.name) rename(item.id, v) }}
              className="flex-1 text-sm text-gray-200 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
            />
            <button onClick={() => remove(item.id)} className="text-gray-700 hover:text-red-400 transition-colors text-sm px-1" title={`Delete ${noun}`}>✕</button>
          </div>
        ))}
        {items.length === 0 && <p className="text-gray-600 text-sm italic">No {noun}s yet.</p>}
      </div>
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={`Add ${noun}…`}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button onClick={add} disabled={busy || !newName.trim()} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg whitespace-nowrap">Add</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export default function ProductsAdminPanel({
  initialProducts, initialCategories, initialLocations,
}: {
  initialProducts: Item[]
  initialCategories: ProductCategory[]
  initialLocations: InventoryLocation[]
}) {
  const [products, setProducts] = useState<Item[]>(initialProducts)
  const [categories, setCategories] = useState<ProductCategory[]>(initialCategories)
  const [locations, setLocations] = useState<InventoryLocation[]>(initialLocations)
  const [view, setView] = useState<'catalog' | 'settings'>('catalog')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  // add-product form
  const [addingItem, setAddingItem] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', category_id: '', package_price: '', package_size: '', unit: '' })
  const [addBusy, setAddBusy] = useState(false)

  const activeLocations = useMemo(
    () => locations.filter(l => l.is_active).sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)),
    [locations],
  )

  function flash(msg: string) { setError(msg); setTimeout(() => setError(''), 4000) }

  // ----- item helpers -----
  function patchLocal(id: string, patch: Partial<Item>) {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
  }

  async function saveItemField(id: string, field: string, value: unknown) {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } as Item : p))
    const res = await fetch(`/api/admin/products/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); flash(d.error || 'Failed to save') }
  }

  async function saveInventory(productId: string, locationId: string, quantity: number | null) {
    const qty = quantity ?? 0
    const res = await fetch(`/api/admin/products/${productId}/inventory`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: locationId, quantity: qty }),
    })
    if (res.ok) {
      const { inventory } = await res.json()
      setProducts(prev => prev.map(p => {
        if (p.id !== productId) return p
        const others = p.product_location_inventory.filter(r => r.location_id !== locationId)
        return { ...p, product_location_inventory: [...others, inventory] }
      }))
    } else { flash('Failed to save inventory') }
  }

  async function addProduct() {
    if (!newItem.name.trim()) return
    setAddBusy(true)
    const res = await fetch('/api/admin/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newItem.name.trim(),
        category_id: newItem.category_id || null,
        package_price: newItem.package_price.trim() === '' ? null : Number(newItem.package_price),
        package_size: newItem.package_size.trim() === '' ? null : Number(newItem.package_size),
        unit: newItem.unit.trim() || null,
      }),
    })
    setAddBusy(false)
    if (res.ok) {
      const { product } = await res.json()
      setProducts(prev => [...prev, product])
      setNewItem({ name: '', category_id: '', package_price: '', package_size: '', unit: '' })
      setAddingItem(false)
      setExpandedId(product.id)
    } else {
      const d = await res.json().catch(() => ({}))
      flash(d.error || 'Failed to add product')
    }
  }

  async function deleteProduct(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its sub-items + inventory?\n\nThis cannot be undone.`)) return
    const res = await fetch(`/api/admin/products/${id}`, { method: 'DELETE' })
    if (res.ok) setProducts(prev => prev.filter(p => p.id !== id))
    else flash('Failed to delete product')
  }

  // ----- grouping -----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      p.product_variants.some(v => (v.label ?? '').toLowerCase().includes(q)),
    )
  }, [products, search])

  const groups = useMemo(() => {
    const byId = new Map(categories.map(c => [c.id, c.name]))
    const buckets = new Map<string, { key: string; name: string; items: Item[] }>()
    for (const p of filtered) {
      const key = p.category_id ?? '__none__'
      const name = (p.category_id && byId.get(p.category_id)) || 'Uncategorized'
      if (!buckets.has(key)) buckets.set(key, { key, name, items: [] })
      buckets.get(key)!.items.push(p)
    }
    const ordered: { key: string; name: string; items: Item[] }[] = []
    for (const c of categories) if (buckets.has(c.id)) ordered.push(buckets.get(c.id)!)
    if (buckets.has('__none__')) ordered.push(buckets.get('__none__')!)
    ordered.forEach(g => g.items.sort((a, b) => a.name.localeCompare(b.name)))
    return ordered
  }, [filtered, categories])

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const totalItems = products.length
  const totalVariants = products.reduce((s, p) => s + p.product_variants.length, 0)

  return (
    <div className="text-white">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-semibold">Products & Inventory</h2>
          <p className="text-sm text-gray-400 mt-0.5">{totalItems} products · {totalVariants} rates · {activeLocations.length} locations</p>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-red-400 text-sm">{error}</span>}
          <div className="flex rounded-lg border border-gray-700 overflow-hidden">
            <button onClick={() => setView('catalog')} className={`px-4 py-1.5 text-sm ${view === 'catalog' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Catalog</button>
            <button onClick={() => setView('settings')} className={`px-4 py-1.5 text-sm ${view === 'settings' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Settings</button>
          </div>
        </div>
      </div>

      {view === 'settings' ? (
        <div className="space-y-4 max-w-2xl">
          <EntityList
            title="Product Groups" noun="group"
            hint="Product types (Fertilizer, Insecticide, …). Items are organized under these."
            items={categories} endpoint="/api/admin/product-categories"
            deleteWarning="Delete this group? Products in it are kept and become Uncategorized."
            onChange={rows => setCategories(rows as ProductCategory[])} onError={flash}
          />
          <EntityList
            title="Inventory Locations" noun="location"
            hint="Where you store product (Vehicle 1, Shop, North Shop, …). Each becomes an inventory column."
            items={locations} endpoint="/api/admin/inventory-locations"
            deleteWarning="Delete this location? Its inventory counts will be removed."
            onChange={rows => setLocations(rows as InventoryLocation[])} onError={flash}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
              className="flex-1 min-w-[200px] max-w-sm bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            {!addingItem && (
              <button onClick={() => setAddingItem(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg">+ Add product</button>
            )}
          </div>

          {addingItem && (
            <div className="bg-gray-900 border border-indigo-700/40 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Name *</label>
                <input autoFocus value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Group</label>
                <select value={newItem.category_id} onChange={e => setNewItem({ ...newItem, category_id: e.target.value })}
                  className="bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                  <option value="">Uncategorized</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Price</label>
                <input value={newItem.package_price} onChange={e => setNewItem({ ...newItem, package_price: e.target.value })} inputMode="decimal"
                  className="w-24 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white text-right focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Size</label>
                <input value={newItem.package_size} onChange={e => setNewItem({ ...newItem, package_size: e.target.value })} inputMode="decimal"
                  className="w-20 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white text-right focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Unit</label>
                <input value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })} list="product-unit-options" placeholder="lbs"
                  className="w-20 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
              </div>
              <button onClick={addProduct} disabled={addBusy || !newItem.name.trim()} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded">Create</button>
              <button onClick={() => { setAddingItem(false); setNewItem({ name: '', category_id: '', package_price: '', package_size: '', unit: '' }) }} className="text-gray-500 hover:text-gray-300 text-sm px-2 py-1.5">Cancel</button>
            </div>
          )}

          {groups.length === 0 && (
            <p className="text-gray-500 text-sm italic py-8 text-center">No products yet. Click “Add product”, or import your spreadsheet.</p>
          )}

          <div className="space-y-5">
            {groups.map(group => {
              const collapsed = collapsedGroups.has(group.key)
              return (
                <div key={group.key}>
                  <button onClick={() => toggleGroup(group.key)} className="flex items-center gap-2 mb-2 text-left group/header">
                    <span className={`text-gray-500 text-xs transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
                    <h3 className="text-sm font-semibold text-gray-200">{group.name}</h3>
                    <span className="text-xs text-gray-500">({group.items.length})</span>
                  </button>

                  {!collapsed && (
                    <div className="overflow-x-auto border border-gray-800 rounded-xl">
                      <table className="w-full text-sm min-w-[680px]">
                        <thead>
                          <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                            <th className="text-left font-medium px-3 py-2">Product</th>
                            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Pkg price</th>
                            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Size</th>
                            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Cost / 1k</th>
                            {activeLocations.map(loc => (
                              <th key={loc.id} className="text-right font-medium px-3 py-2 whitespace-nowrap">{loc.name}</th>
                            ))}
                            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Total</th>
                            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">$ Value</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map(item => {
                            const expanded = expandedId === item.id
                            const total = inventoryTotal(item.product_location_inventory)
                            const value = inventoryValue(total, item.package_price)
                            const cost = itemCostSummary(item)
                            const variantCount = item.product_variants.length
                            const colSpan = 7 + activeLocations.length
                            return (
                              <Fragment key={item.id}>
                                <tr className={`border-b border-gray-800/60 hover:bg-gray-900/40 ${expanded ? 'bg-gray-900/40' : ''}`}>
                                  <td className="px-3 py-2">
                                    <button onClick={() => setExpandedId(expanded ? null : item.id)} className="flex items-start gap-2 text-left">
                                      <span className={`text-gray-600 text-xs mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                                      <span>
                                        <span className="text-white font-medium">{item.name}</span>
                                        {variantCount > 0 && <span className="ml-2 text-[11px] text-gray-500">{variantCount} rate{variantCount === 1 ? '' : 's'}</span>}
                                        {!item.is_active && <span className="ml-2 text-[11px] text-amber-500">inactive</span>}
                                        {item.description && <span className="block text-xs text-gray-500">{item.description}</span>}
                                      </span>
                                    </button>
                                  </td>
                                  <td className="px-3 py-2 text-right"><NumberCell value={item.package_price} prefix="$" width="w-20" onSave={n => saveItemField(item.id, 'package_price', n)} /></td>
                                  <td className="px-3 py-2 text-right text-gray-400 whitespace-nowrap">{item.package_size != null ? `${fmtNum(item.package_size)} ${item.unit ?? ''}` : '—'}</td>
                                  <td className="px-3 py-2 text-right text-gray-300 whitespace-nowrap">{cost ?? '—'}</td>
                                  {activeLocations.map(loc => {
                                    const row = item.product_location_inventory.find(r => r.location_id === loc.id)
                                    return (
                                      <td key={loc.id} className="px-3 py-2 text-right">
                                        <NumberCell value={row ? row.quantity : null} placeholder="0" width="w-16" onSave={n => saveInventory(item.id, loc.id, n)} />
                                      </td>
                                    )
                                  })}
                                  <td className="px-3 py-2 text-right text-gray-200 font-medium">{fmtNum(total)}</td>
                                  <td className="px-3 py-2 text-right text-emerald-400 whitespace-nowrap">{fmtMoney(value)}</td>
                                  <td className="px-2 py-2 text-right">
                                    <button onClick={() => deleteProduct(item.id, item.name)} className="text-gray-700 hover:text-red-400 text-sm" title="Delete product">✕</button>
                                  </td>
                                </tr>
                                {expanded && (
                                  <tr key={`${item.id}-x`}>
                                    <td colSpan={colSpan} className="px-3 pb-4 pt-1 bg-gray-900/40">
                                      <ItemEditor item={item} categories={categories} onSaveField={(f, v) => saveItemField(item.id, f, v)} onError={flash} />
                                      <VariantManager item={item} onChange={vs => patchLocal(item.id, { product_variants: vs })} onError={flash} />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {activeLocations.length === 0 && (
            <p className="text-gray-500 text-xs mt-4">Tip: add storage locations under <button onClick={() => setView('settings')} className="text-indigo-400 hover:text-indigo-300 underline">Settings</button> to start tracking inventory.</p>
          )}
        </>
      )}

      <datalist id="product-unit-options">
        {UNIT_OPTIONS.map(u => <option key={u} value={u} />)}
      </datalist>
    </div>
  )
}
