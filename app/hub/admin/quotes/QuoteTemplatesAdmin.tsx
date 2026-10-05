'use client'

// Quote templates (Work Orders & Quotes PRD — Phase 4, session 2). Ben builds
// his own (Oct 5 2026) — nothing is seeded. A template is a starting point:
// title, intro, line items (some as add-ons the customer may tick), an
// optional deposit, up to 3 reviews and the terms. Picking it on a quote copies
// it, so a later edit here never changes a quote already made.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { depositAmount, MAX_QUOTE_REVIEWS, type DepositType, type TemplateItem } from '@/lib/quotes'

type Template = {
  id: string
  name: string
  service_line: string | null
  title: string
  intro: string
  terms: string
  default_items: TemplateItem[]
  default_review_ids: string[]
  deposit_type: DepositType | null
  deposit_value: number | null
  is_active: boolean
  sort_order: number
}
type Review = { id: string; author: string; rating: number; body: string; featured: boolean }
type Product = { id: string; name: string; description: string | null; price: number; category: string | null }
/** Prices are edited as text so a blank means "priced on each quote". */
type RowDraft = Omit<TemplateItem, 'unit_price' | 'quantity'> & { key: string; unit_price: string; quantity: string }
type Draft = {
  id?: string
  name: string
  service_line: string
  title: string
  intro: string
  terms: string
  items: RowDraft[]
  review_ids: string[]
  deposit_type: '' | DepositType
  deposit_value: string
  is_active: boolean
  sort_order: string
}

const inp = 'w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30 text-base md:text-sm'
const lbl = 'block text-[11px] uppercase tracking-wide text-gray-500 mb-1'
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
let keySeq = 0
const nextKey = () => `r${++keySeq}`

function toDraft(t?: Template, copy = false): Draft {
  if (!t) {
    return { name: '', service_line: '', title: '', intro: '', terms: '', items: [], review_ids: [], deposit_type: '', deposit_value: '', is_active: true, sort_order: '0' }
  }
  return {
    id: copy ? undefined : t.id,
    name: copy ? `${t.name} (copy)` : t.name,
    service_line: t.service_line ?? '',
    title: t.title,
    intro: t.intro,
    terms: t.terms,
    items: (t.default_items ?? []).map(i => ({ ...i, key: nextKey(), quantity: String(i.quantity ?? 1), unit_price: i.unit_price == null ? '' : String(i.unit_price) })),
    review_ids: t.default_review_ids ?? [],
    deposit_type: t.deposit_type ?? '',
    deposit_value: t.deposit_value == null ? '' : String(t.deposit_value),
    is_active: copy ? true : t.is_active,
    sort_order: String(t.sort_order ?? 0),
  }
}

function toBody(d: Draft) {
  return {
    id: d.id,
    name: d.name,
    service_line: d.service_line,
    title: d.title,
    intro: d.intro,
    terms: d.terms,
    default_items: d.items.map(i => ({
      jobber_product_id: i.jobber_product_id,
      name: i.name,
      description: i.description,
      quantity: Number(i.quantity) || 1,
      unit_price: i.unit_price.trim() === '' ? null : i.unit_price.trim(),
      optional: i.optional,
      recommended: i.recommended,
    })),
    default_review_ids: d.review_ids,
    deposit_type: d.deposit_type || null,
    deposit_value: d.deposit_type ? d.deposit_value : null,
    is_active: d.is_active,
    sort_order: Number(d.sort_order) || 0,
  }
}

function depositLabel(type: DepositType | null, value: number | null) {
  if (!type || value == null) return 'No deposit'
  return type === 'percent' ? `${value}% deposit` : `${money(value)} deposit`
}

export default function QuoteTemplatesAdmin() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [tRes, rRes] = await Promise.all([
      fetch('/api/hub/quotes/templates?all=1', { cache: 'no-store' }),
      fetch('/api/hub/quotes/reviews', { cache: 'no-store' }),
    ])
    const t = await tRes.json()
    const r = await rRes.json()
    if (!tRes.ok) { setError(t.error ?? 'Could not load'); return }
    setTemplates(t.templates)
    if (rRes.ok) setReviews(r.reviews)
  }, [])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editing || saving) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/hub/quotes/templates', {
        method: editing.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toBody(editing)),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error ?? 'Could not save'); return }
      setEditing(null)
      await load()
    } finally { setSaving(false) }
  }

  async function remove(t: Template) {
    if (!window.confirm(`Delete the “${t.name}” template? Quotes already made from it are not changed.`)) return
    await fetch(`/api/hub/quotes/templates?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' })
    await load()
  }

  async function toggle(t: Template) {
    await fetch('/api/hub/quotes/templates', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, is_active: !t.is_active }),
    })
    await load()
  }

  if (editing) {
    return (
      <TemplateEditor
        draft={editing}
        setDraft={setEditing}
        reviews={reviews}
        serviceLines={Array.from(new Set((templates ?? []).map(t => t.service_line).filter((s): s is string => !!s))).sort()}
        error={error}
        saving={saving}
        onSave={save}
        onCancel={() => { setEditing(null); setError(null) }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        A template is the starting point for a quote: the title, a short intro, the line items, an optional deposit, the reviews and your terms.
        Mark a line as an <strong className="text-gray-200">add-on</strong> to let the customer tick it on or off. Leave a price blank when it
        changes per customer (it’s filled in on each quote).
      </p>
      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}
      <button type="button" onClick={() => setEditing(toDraft())}
        className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm text-white">+ New template</button>

      {!templates ? <div className="text-sm text-gray-500">Loading…</div> : templates.length === 0 ? (
        <div className="text-sm text-gray-500">No templates yet. Make your first one with <em>+ New template</em>.</div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => {
            const items = t.default_items ?? []
            const addOns = items.filter(i => i.optional).length
            return (
              <div key={t.id} className={`rounded-lg border border-white/10 p-3 ${t.is_active ? 'bg-white/[0.03]' : 'opacity-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">
                      {t.name}
                      {t.service_line && <span className="text-gray-400 font-normal"> · {t.service_line}</span>}
                      {!t.is_active && <span className="ml-2 text-[11px] text-gray-400">(off)</span>}
                    </div>
                    <div className="text-[12px] text-gray-500 mt-0.5">
                      {items.length - addOns} line{items.length - addOns === 1 ? '' : 's'}
                      {addOns > 0 && ` + ${addOns} add-on${addOns === 1 ? '' : 's'}`}
                      {' · '}{depositLabel(t.deposit_type, t.deposit_value)}
                      {' · '}{(t.default_review_ids ?? []).length} review{(t.default_review_ids ?? []).length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-xs flex-wrap justify-end">
                    <button type="button" onClick={() => toggle(t)} className="text-gray-400 hover:text-white">{t.is_active ? 'Turn off' : 'Turn on'}</button>
                    <button type="button" onClick={() => setEditing(toDraft(t, true))} className="text-gray-400 hover:text-white">Duplicate</button>
                    <button type="button" onClick={() => setEditing(toDraft(t))} className="text-sky-300 hover:text-sky-200">Edit</button>
                    <button type="button" onClick={() => remove(t)} className="text-red-300 hover:text-red-200">Delete</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TemplateEditor({ draft, setDraft, reviews, serviceLines, error, saving, onSave, onCancel }: {
  draft: Draft
  setDraft: (d: Draft) => void
  reviews: Review[]
  serviceLines: string[]
  error: string | null
  saving: boolean
  onSave: () => void
  onCancel: () => void
}) {
  const [catalog, setCatalog] = useState<Product[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const setItem = (key: string, patch: Partial<RowDraft>) =>
    set({ items: draft.items.map(i => (i.key === key ? { ...i, ...patch } : i)) })
  const move = (key: string, dir: -1 | 1) => {
    const idx = draft.items.findIndex(i => i.key === key)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= draft.items.length) return
    const items = [...draft.items]
    ;[items[idx], items[to]] = [items[to], items[idx]]
    set({ items })
  }

  async function openPicker() {
    setPicking(true)
    if (catalog || catalogError) return
    const res = await fetch('/api/hub/quotes/catalog', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok) setCatalogError(j.error ?? 'Could not read Jobber')
    else setCatalog(j.products)
  }

  function addProduct(p: Product) {
    set({
      items: [...draft.items, {
        key: nextKey(), jobber_product_id: p.id, name: p.name, description: p.description ?? '',
        quantity: '1', unit_price: p.price ? String(p.price) : '', optional: false, recommended: false,
      }],
    })
    setPicking(false); setSearch('')
  }

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = catalog ?? []
    return (q ? list.filter(p => p.name.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q)) : list).slice(0, 50)
  }, [catalog, search])

  // A preview of the totals with the prices the template already has.
  const totals = useMemo(() => {
    let required = 0, addOns = 0, unpriced = 0
    for (const i of draft.items) {
      if (i.unit_price.trim() === '') { unpriced++; continue }
      const t = (Number(i.quantity) || 0) * (Number(i.unit_price) || 0)
      if (i.optional) addOns += t; else required += t
    }
    return { required, addOns, unpriced }
  }, [draft.items])
  const deposit = draft.deposit_type ? depositAmount(totals.required, draft.deposit_type, Number(draft.deposit_value)) : null

  const toggleReview = (id: string) => {
    if (draft.review_ids.includes(id)) set({ review_ids: draft.review_ids.filter(x => x !== id) })
    else if (draft.review_ids.length < MAX_QUOTE_REVIEWS) set({ review_ids: [...draft.review_ids, id] })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">{draft.id ? 'Edit template' : 'New template'}</h2>
        <button type="button" onClick={onCancel} className="text-sm text-gray-400 hover:text-white">← Back to templates</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}

      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block md:col-span-2">
            <span className={lbl}>Template name (only your team sees this)</span>
            <input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Aeration + overseed" className={inp} />
          </label>
          <label className="block">
            <span className={lbl}>Service line (optional)</span>
            <input list="quote-service-lines" value={draft.service_line} onChange={e => set({ service_line: e.target.value })} placeholder="e.g. Lawn care" className={inp} />
            <datalist id="quote-service-lines">{serviceLines.map(s => <option key={s} value={s} />)}</datalist>
          </label>
        </div>
        <label className="block">
          <span className={lbl}>Quote title (the customer sees this at the top)</span>
          <input value={draft.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Your fall aeration & overseeding plan" className={inp} />
        </label>
        <label className="block">
          <span className={lbl}>Intro</span>
          <textarea value={draft.intro} onChange={e => set({ intro: e.target.value })} rows={4}
            placeholder="A few friendly lines about what you're proposing and why." className={`${inp} resize-y`} />
        </label>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Line items</h3>
          <p className="text-[12px] text-gray-500">
            Tick <strong className="text-gray-300">Add-on</strong> for extras the customer can choose — they start unticked on the quote.
            Leave the price blank to fill it in on each quote.
          </p>
        </div>

        {draft.items.length === 0 && <div className="text-sm text-gray-500">No line items yet.</div>}
        <div className="space-y-2">
          {draft.items.map((i, idx) => (
            <div key={i.key} className={`rounded-md border p-2 space-y-2 ${i.optional ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-white/10'}`}>
              <div className="grid grid-cols-12 gap-2">
                <input value={i.name} onChange={e => setItem(i.key, { name: e.target.value })} placeholder="Name"
                  className={`${inp} col-span-12 md:col-span-6`} />
                <input value={i.quantity} onChange={e => setItem(i.key, { quantity: e.target.value })} inputMode="decimal" placeholder="Qty"
                  className={`${inp} col-span-4 md:col-span-2`} aria-label="Quantity" />
                <input value={i.unit_price} onChange={e => setItem(i.key, { unit_price: e.target.value })} inputMode="decimal" placeholder="Per quote"
                  className={`${inp} col-span-8 md:col-span-4`} aria-label="Unit price" />
              </div>
              <textarea value={i.description} onChange={e => setItem(i.key, { description: e.target.value })} rows={2}
                placeholder="Description the customer reads (optional)" className={`${inp} resize-y`} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <label className="flex items-center gap-1.5 text-gray-300">
                  <input type="checkbox" checked={i.optional} onChange={e => setItem(i.key, { optional: e.target.checked, recommended: e.target.checked ? i.recommended : false })} />
                  Add-on
                </label>
                {i.optional && (
                  <label className="flex items-center gap-1.5 text-gray-300">
                    <input type="checkbox" checked={i.recommended} onChange={e => setItem(i.key, { recommended: e.target.checked })} />
                    Show “Recommended”
                  </label>
                )}
                {i.jobber_product_id && <span className="text-gray-500">From Jobber</span>}
                <span className="flex-1" />
                <button type="button" onClick={() => move(i.key, -1)} disabled={idx === 0} className="text-gray-400 hover:text-white disabled:opacity-30">↑</button>
                <button type="button" onClick={() => move(i.key, 1)} disabled={idx === draft.items.length - 1} className="text-gray-400 hover:text-white disabled:opacity-30">↓</button>
                <button type="button" onClick={() => set({ items: draft.items.filter(x => x.key !== i.key) })} className="text-red-300 hover:text-red-200">Remove</button>
              </div>
            </div>
          ))}
        </div>

        {picking ? (
          <div className="rounded-md border border-white/10 p-2 space-y-2">
            <div className="flex gap-2">
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Jobber products & services" className={inp} />
              <button type="button" onClick={() => { setPicking(false); setSearch('') }} className="px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm text-gray-300">Close</button>
            </div>
            {catalogError ? <div className="text-sm text-red-300">{catalogError}</div> : !catalog ? <div className="text-sm text-gray-500">Reading Jobber…</div> : (
              <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
                {matches.length === 0 && <div className="text-sm text-gray-500 py-2">Nothing matches.</div>}
                {matches.map(p => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)} className="w-full text-left py-2 px-1 hover:bg-white/5 flex justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm text-white truncate">{p.name}</span>
                      {p.category && <span className="block text-[11px] text-gray-500">{p.category}</span>}
                    </span>
                    <span className="text-sm text-gray-300 shrink-0">{p.price ? money(p.price) : '—'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={openPicker} className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white">+ From Jobber</button>
            <button type="button" onClick={() => set({ items: [...draft.items, { key: nextKey(), jobber_product_id: null, name: '', description: '', quantity: '1', unit_price: '', optional: false, recommended: false }] })}
              className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white">+ Blank line</button>
          </div>
        )}

        {draft.items.length > 0 && (
          <div className="text-[13px] text-gray-400 border-t border-white/10 pt-2">
            Starting total <span className="text-white font-medium">{money(totals.required)}</span>
            {totals.addOns > 0 && <> · add-ons up to <span className="text-white">{money(totals.addOns)}</span></>}
            {totals.unpriced > 0 && <> · {totals.unpriced} line{totals.unpriced === 1 ? '' : 's'} priced on each quote</>}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <h3 className="text-sm font-semibold text-white">Deposit</h3>
        <p className="text-[12px] text-gray-500">Optional. After approving, the customer gets a <em>Pay deposit</em> button that opens Jobber’s payment page.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={draft.deposit_type} onChange={e => set({ deposit_type: e.target.value as Draft['deposit_type'] })} className={`${inp} w-auto`}>
            <option value="">No deposit</option>
            <option value="percent">Percent of the total</option>
            <option value="fixed">Fixed amount</option>
          </select>
          {draft.deposit_type && (
            <div className="flex items-center gap-1">
              {draft.deposit_type === 'fixed' && <span className="text-gray-400">$</span>}
              <input value={draft.deposit_value} onChange={e => set({ deposit_value: e.target.value })} inputMode="decimal" className={`${inp} w-28`} placeholder={draft.deposit_type === 'percent' ? '25' : '100'} />
              {draft.deposit_type === 'percent' && <span className="text-gray-400">%</span>}
            </div>
          )}
          {deposit != null && totals.required > 0 && <span className="text-[13px] text-gray-400">= {money(deposit)} on the starting total</span>}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <h3 className="text-sm font-semibold text-white">Reviews <span className="text-gray-500 font-normal">({draft.review_ids.length} of {MAX_QUOTE_REVIEWS})</span></h3>
        {reviews.length === 0 ? (
          <p className="text-[12px] text-gray-500">No reviews yet — add them on the Reviews tab, then pick up to 3 here.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {reviews.map(r => {
              const on = draft.review_ids.includes(r.id)
              const full = !on && draft.review_ids.length >= MAX_QUOTE_REVIEWS
              return (
                <label key={r.id} className={`flex items-start gap-2 rounded-md p-2 border ${on ? 'border-indigo-400/40 bg-indigo-500/10' : 'border-white/5'} ${full ? 'opacity-40' : 'cursor-pointer'}`}>
                  <input type="checkbox" className="mt-1" checked={on} disabled={full} onChange={() => toggleReview(r.id)} />
                  <span className="min-w-0">
                    <span className="block text-sm text-white">{r.author} <span className="text-amber-300">{'★'.repeat(r.rating)}</span>{r.featured && <span className="text-[11px] text-indigo-200"> · Featured</span>}</span>
                    <span className="block text-[12px] text-gray-400 line-clamp-2">{r.body}</span>
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <label className="block">
          <span className={lbl}>Terms</span>
          <textarea value={draft.terms} onChange={e => set({ terms: e.target.value })} rows={6}
            placeholder="Payment terms, scheduling, guarantees, what's not included…" className={`${inp} resize-y`} />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={draft.is_active} onChange={e => set({ is_active: e.target.checked })} />
            On — can be picked when building a quote
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            List order
            <input value={draft.sort_order} onChange={e => set({ sort_order: e.target.value })} inputMode="numeric" className={`${inp} w-20`} />
          </label>
        </div>
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={onSave} disabled={saving} className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save template'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-gray-300">Cancel</button>
      </div>
    </div>
  )
}
