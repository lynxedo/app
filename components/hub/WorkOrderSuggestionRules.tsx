'use client'

// Work Orders Phase 2 (Part 2) — the office's "Suggested from inspection" rules.
// Each rule: when a finished irrigation inspection shows X, suggest catalog item
// Y on that stop. The tech still taps Add on every suggestion.

import { useCallback, useEffect, useMemo, useState } from 'react'

type Rule = {
  id: string
  trigger_kind: 'zone_issue' | 'field'
  trigger_text: string | null
  head_filter: string | null
  trigger_field: string | null
  trigger_value: string | null
  jobber_product_id: string
  product_name: string
  quantity_mode: 'number_in_text' | 'per_zone' | 'fixed'
  fixed_quantity: number
  is_active: boolean
}
type Field = { key: string; label: string; options: Array<{ v: string; label: string }> }
type Product = { id: string; name: string; price: number }

const QTY_LABEL: Record<Rule['quantity_mode'], string> = {
  number_in_text: 'the number written before the word (e.g. “2 broken heads” → 2)',
  per_zone: '1 for each zone that matches',
  fixed: 'a fixed quantity',
}

const EMPTY: Omit<Rule, 'id'> = {
  trigger_kind: 'zone_issue', trigger_text: '', head_filter: '', trigger_field: null, trigger_value: null,
  jobber_product_id: '', product_name: '', quantity_mode: 'number_in_text', fixed_quantity: 1, is_active: true,
}

export default function WorkOrderSuggestionRules() {
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [fields, setFields] = useState<Field[]>([])
  const [products, setProducts] = useState<Product[] | null>(null)
  const [editing, setEditing] = useState<(Omit<Rule, 'id'> & { id?: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/hub/work-orders/suggestion-rules', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok) { setError(j.error ?? 'Could not load rules'); return }
    setRules(j.rules)
    setFields(j.fields)
  }, [])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!editing || products) return
    fetch('/api/hub/work-orders/catalog', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setProducts(j.products ?? []))
      .catch(() => setProducts([]))
  }, [editing, products])

  async function save() {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/hub/work-orders/suggestion-rules', {
        method: editing.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Could not save')
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(rule: Rule) {
    setRules(rs => rs?.map(r => r.id === rule.id ? { ...r, is_active: !r.is_active } : r) ?? rs)
    await fetch('/api/hub/work-orders/suggestion-rules', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
    })
  }

  async function remove(rule: Rule) {
    if (!confirm(`Delete the rule for “${rule.product_name}”?`)) return
    setRules(rs => rs?.filter(r => r.id !== rule.id) ?? rs)
    await fetch(`/api/hub/work-orders/suggestion-rules?id=${rule.id}`, { method: 'DELETE' })
  }

  const describe = (r: Omit<Rule, 'id'>) => {
    if (r.trigger_kind === 'field') {
      const f = fields.find(x => x.key === r.trigger_field)
      const v = f?.options.find(o => o.v === r.trigger_value)?.label ?? r.trigger_value
      return `${f?.label ?? r.trigger_field} is “${v}”`
    }
    const words = (r.trigger_text ?? '').split(',').map(w => w.trim()).filter(Boolean).map(w => `“${w}”`).join(' or ')
    return `a zone’s issues mention ${words}${r.head_filter ? ` on a ${r.head_filter} zone` : ''}`
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">
        When an irrigation inspection done from a stop is finished, these rules suggest line items on that stop. The tech taps <em>Add</em> or ✕ on each one — nothing is sent to Jobber until they add it. Prices come from the Jobber catalog at the time.
      </p>
      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm mb-2">{error}</div>}
      {!rules && !error && <div className="text-sm text-gray-500">Loading…</div>}

      {rules && (
        <div className="space-y-2">
          {rules.length === 0 && <div className="text-sm text-gray-400 bg-white/5 rounded px-3 py-3">No rules yet.</div>}
          {rules.map(r => (
            <div key={r.id} className={`bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2.5 ${r.is_active ? '' : 'opacity-60'}`}>
              <div className="text-sm text-gray-200">
                When {describe(r)} → suggest <strong className="text-white">{r.product_name}</strong>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Quantity: {r.quantity_mode === 'fixed' ? `${r.fixed_quantity}` : QTY_LABEL[r.quantity_mode]}
              </div>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => setEditing({ ...r })} className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-gray-200">Edit</button>
                <button type="button" onClick={() => void toggle(r)} className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-gray-200">{r.is_active ? 'Turn off' : 'Turn on'}</button>
                <button type="button" onClick={() => void remove(r)} className="px-2.5 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-xs text-red-200">Delete</button>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setEditing({ ...EMPTY })}
            className="w-full py-2 rounded border border-dashed border-gray-700 text-sm text-gray-300 hover:bg-white/5">+ Add a rule</button>
        </div>
      )}

      {editing && (
        <RuleForm rule={editing} fields={fields} products={products} saving={saving} error={error}
          onChange={setEditing} onCancel={() => { setEditing(null); setError(null) }} onSave={() => void save()} />
      )}
    </div>
  )
}

function RuleForm({ rule, fields, products, saving, error, onChange, onCancel, onSave }: {
  rule: Omit<Rule, 'id'> & { id?: string }
  error: string | null
  fields: Field[]
  products: Product[] | null
  saving: boolean
  onChange: (r: Omit<Rule, 'id'> & { id?: string }) => void
  onCancel: () => void
  onSave: () => void
}) {
  const [search, setSearch] = useState('')
  const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch })
  const field = fields.find(f => f.key === rule.trigger_field)
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!products || !q) return []
    return products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 12)
  }, [products, search])
  const input = 'w-full h-9 px-2.5 rounded bg-gray-900 border border-gray-700 text-sm text-white outline-none focus:border-indigo-500'
  const label = 'block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5'

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={onCancel}>
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-gray-950 border border-gray-800 rounded-t-xl sm:rounded-xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="text-base font-medium text-white">{rule.id ? 'Edit rule' : 'New rule'}</div>

        <div>
          <span className={label}>When the inspection shows</span>
          <div className="flex gap-1.5">
            {(['zone_issue', 'field'] as const).map(k => (
              <button key={k} type="button" onClick={() => set({ trigger_kind: k, ...(k === 'field' ? { quantity_mode: 'fixed' as const } : {}) })}
                className={`px-3 py-1.5 rounded-full text-xs ${rule.trigger_kind === k ? 'bg-indigo-600 text-white' : 'bg-white/10 text-gray-300'}`}>
                {k === 'zone_issue' ? 'A zone issue' : 'A system answer'}
              </button>
            ))}
          </div>
        </div>

        {rule.trigger_kind === 'zone_issue' ? (
          <>
            <label className="block">
              <span className={label}>Issue mentions (separate several with commas)</span>
              <input className={input} value={rule.trigger_text ?? ''} onChange={e => set({ trigger_text: e.target.value })} placeholder="broken, cracked" />
            </label>
            <label className="block">
              <span className={label}>Only on zones with head type (optional)</span>
              <input className={input} value={rule.head_filter ?? ''} onChange={e => set({ head_filter: e.target.value })} placeholder="Spray, Rotor, Drip… — blank = any zone" />
            </label>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={label}>Field</span>
              <select className={input} value={rule.trigger_field ?? ''} onChange={e => set({ trigger_field: e.target.value || null, trigger_value: null })}>
                <option value="">Pick…</option>
                {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={label}>Is</span>
              <select className={input} value={rule.trigger_value ?? ''} onChange={e => set({ trigger_value: e.target.value || null })} disabled={!field}>
                <option value="">Pick…</option>
                {field?.options.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
          </div>
        )}

        <div>
          <span className={label}>Suggest this catalog item</span>
          {rule.product_name && (
            <div className="text-sm text-white mb-1">{rule.product_name}</div>
          )}
          <input className={input} value={search} onChange={e => setSearch(e.target.value)}
            placeholder={products ? (rule.product_name ? 'Search to change…' : 'Search the Jobber catalog…') : 'Loading the catalog…'} />
          {matches.length > 0 && (
            <div className="mt-1 border border-gray-800 rounded overflow-hidden">
              {matches.map(p => (
                <button key={p.id} type="button" onClick={() => { set({ jobber_product_id: p.id, product_name: p.name }); setSearch('') }}
                  className="w-full text-left px-2.5 py-2 text-sm text-gray-200 hover:bg-white/5 border-b border-gray-900 last:border-b-0 flex justify-between gap-2">
                  <span className="truncate">{p.name}</span><span className="text-gray-500 shrink-0">${p.price}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className={label}>Quantity</span>
          <select className={input} value={rule.quantity_mode} onChange={e => set({ quantity_mode: e.target.value as Rule['quantity_mode'] })}>
            {rule.trigger_kind === 'zone_issue' && <option value="number_in_text">The number written before the word</option>}
            {rule.trigger_kind === 'zone_issue' && <option value="per_zone">1 for each matching zone</option>}
            <option value="fixed">A fixed quantity</option>
          </select>
          {rule.quantity_mode === 'fixed' && (
            <input className={`${input} mt-1.5 w-24`} inputMode="decimal" value={String(rule.fixed_quantity)}
              onChange={e => set({ fixed_quantity: Number(e.target.value) || 0 })} />
          )}
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" disabled={saving} onClick={onSave} className="flex-1 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save rule'}</button>
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-gray-200 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  )
}
