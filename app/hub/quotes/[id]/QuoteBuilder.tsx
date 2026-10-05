'use client'

// The quote builder (Work Orders & Quotes PRD — Phase 4, session 3). Opens on a
// DRAFT that was started from a template (or blank) for one customer, and
// autosaves as you type. Sections: customer + property (lawn size), title +
// intro, what's included, add-ons (unticked for the customer), deposit,
// reviews (up to 3), terms, internal notes (never shown to the customer).
// Lines come from the live Jobber catalog, the Pricer (program price by lawn
// size) or a blank line. Preview shows exactly what the customer will see.
// Sending arrives in session 4.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import CustomerQuoteView from '@/components/quotes/CustomerQuoteView'
import { perVisitAt } from '@/lib/service-builder'
import {
  depositAmount, MAX_QUOTE_REVIEWS, pricerLine, STATUS_LABEL, toCustomerQuote, unpricedItems,
  type DepositType, type PricerProgram, type QuoteItem, type QuoteStatus,
} from '@/lib/quotes'

type Property = { jobberId: string | null; address: string; lawnK: number | null; zones: number | null }
type Contact = { id: string; name: string; phone: string | null; email: string | null; doNotText: boolean; jobberClientId: string | null }
type Review = { id: string; author: string; rating: number; body: string; source: string; review_date: string | null; featured: boolean }
type Product = { id: string; name: string; description: string | null; price: number; category: string | null }
type Row = {
  key: string
  name: string
  description: string
  quantity: string
  /** '' = not priced yet. */
  unit_price: string
  optional: boolean
  recommended: boolean
  jobber_product_id: string | null
  pricer_ref: Record<string, unknown> | null
}
type Draft = {
  title: string
  intro: string
  terms: string
  internal_notes: string
  review_ids: string[]
  deposit_type: '' | DepositType
  deposit_value: string
  property_key: string
  lawn_size_k: string
  items: Row[]
}
type Loaded = {
  quote: { id: string; status: QuoteStatus; contact_id: string; jobber_property_id: string | null; property_address: string | null; sent_at: string | null; expires_at: string | null; updated_at: string }
  contact: Contact
  properties: Property[]
  companyName: string
}

const inp = 'w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30 text-base md:text-sm'
const lbl = 'block text-[11px] uppercase tracking-wide text-gray-500 mb-1'
const card = 'rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3'
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
let seq = 0
const nextKey = () => `q${++seq}`
const propKey = (p: Pick<Property, 'jobberId' | 'address'>) => p.jobberId ?? `addr:${p.address}`

function rowFrom(i: Partial<QuoteItem> & { pricer_ref?: unknown }): Row {
  return {
    key: nextKey(),
    name: i.name ?? '',
    description: i.description ?? '',
    quantity: String(i.quantity ?? 1),
    unit_price: i.unit_price == null ? '' : String(i.unit_price),
    optional: !!i.optional,
    recommended: !!i.optional && !!i.recommended,
    jobber_product_id: i.jobber_product_id ?? null,
    pricer_ref: (i.pricer_ref && typeof i.pricer_ref === 'object' ? i.pricer_ref : null) as Record<string, unknown> | null,
  }
}
const rowItem = (r: Row): QuoteItem => ({
  id: r.key,
  name: r.name,
  description: r.description,
  quantity: Number(r.quantity) || 1,
  unit_price: r.unit_price.trim() === '' ? null : Number(r.unit_price),
  optional: r.optional,
  recommended: r.recommended,
  jobber_product_id: r.jobber_product_id,
})

export default function QuoteBuilder({ quoteId }: { quoteId: string }) {
  const router = useRouter()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [preview, setPreview] = useState(false)
  const [picker, setPicker] = useState<null | { kind: 'jobber' | 'pricer'; optional: boolean }>(null)
  const draftRef = useRef<Draft | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const [qRes, rRes] = await Promise.all([
      fetch(`/api/hub/quotes/${quoteId}`, { cache: 'no-store' }),
      fetch('/api/hub/quotes/reviews', { cache: 'no-store' }),
    ])
    const q = await qRes.json()
    if (!qRes.ok) { setError(q.error ?? 'Could not load the quote'); return }
    const r = await rRes.json()
    if (rRes.ok) setReviews(r.reviews)
    const properties: Property[] = q.customer?.properties ?? []
    const qq = q.quote
    // The quote's property, or the address it was started with if it isn't a Jobber property.
    let key = ''
    const hit = properties.find(p => (qq.jobber_property_id && p.jobberId === qq.jobber_property_id) || (!qq.jobber_property_id && p.address === qq.property_address))
    if (hit) key = propKey(hit)
    else if (qq.property_address) { properties.push({ jobberId: null, address: qq.property_address, lawnK: null, zones: null }); key = `addr:${qq.property_address}` }
    setLoaded({ quote: qq, contact: q.customer?.contact, properties, companyName: q.companyName ?? '' })
    const d: Draft = {
      title: qq.title ?? '',
      intro: qq.intro ?? '',
      terms: qq.terms ?? '',
      internal_notes: qq.internal_notes ?? '',
      review_ids: qq.review_ids ?? [],
      deposit_type: qq.deposit_type ?? '',
      deposit_value: qq.deposit_value == null ? '' : String(qq.deposit_value),
      property_key: key,
      lawn_size_k: qq.lawn_size_k == null ? '' : String(qq.lawn_size_k),
      items: (q.items ?? []).map(rowFrom),
    }
    draftRef.current = d
    setDraft(d)
  }, [quoteId])
  useEffect(() => { void load() }, [load])

  const save = useCallback(async () => {
    const d = draftRef.current
    if (!d || !loaded) return
    const prop = loaded.properties.find(p => propKey(p) === d.property_key)
    setSaveState('saving')
    const res = await fetch(`/api/hub/quotes/${quoteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: d.title, intro: d.intro, terms: d.terms, internal_notes: d.internal_notes,
        review_ids: d.review_ids,
        deposit_type: d.deposit_type || null, deposit_value: d.deposit_type ? d.deposit_value : null,
        jobber_property_id: prop?.jobberId ?? null, property_address: prop?.address ?? null,
        lawn_size_k: d.lawn_size_k,
        items: d.items.map(r => ({ ...rowItem(r), unit_price: r.unit_price.trim() === '' ? null : r.unit_price, pricer_ref: r.pricer_ref })),
      }),
    })
    if (draftRef.current !== d) return // edited again while saving; the next save covers it
    if (res.ok) { setSaveState('saved'); setError(null) }
    else {
      const j = await res.json().catch(() => ({}))
      setSaveState('error'); setError(j.error ?? 'Could not save')
    }
  }, [loaded, quoteId])

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      draftRef.current = next
      return next
    })
    setSaveState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void save() }, 800)
  }, [save])

  // Flush a pending save when leaving the page.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void save() } }, [save])

  const items = useMemo(() => (draft?.items ?? []).map(rowItem), [draft?.items])
  const totals = useMemo(() => {
    let required = 0, addOns = 0
    for (const i of items) {
      const t = (Number(i.quantity) || 0) * (Number(i.unit_price) || 0)
      if (i.optional) addOns += t; else required += t
    }
    return { required: Math.round(required * 100) / 100, addOns: Math.round(addOns * 100) / 100 }
  }, [items])

  if (error && !draft) return <div className="p-6 text-red-300">{error}</div>
  if (!draft || !loaded) return <div className="p-6 text-gray-400">Loading…</div>

  const isDraft = loaded.quote.status === 'draft'
  const property = loaded.properties.find(p => propKey(p) === draft.property_key) ?? null
  const unpriced = unpricedItems(items).length
  const deposit = draft.deposit_type ? depositAmount(totals.required, draft.deposit_type, Number(draft.deposit_value)) : null
  const setRow = (key: string, patch: Partial<Row>) => update({ items: draft.items.map(r => (r.key === key ? { ...r, ...patch } : r)) })
  const moveRow = (key: string, dir: -1 | 1) => {
    const list = [...draft.items]
    const idx = list.findIndex(r => r.key === key)
    // Move within the same section (included vs add-ons).
    let to = idx + dir
    while (to >= 0 && to < list.length && list[to].optional !== list[idx].optional) to += dir
    if (idx < 0 || to < 0 || to >= list.length) return
    ;[list[idx], list[to]] = [list[to], list[idx]]
    update({ items: list })
  }
  const addRow = (r: Row) => update({ items: [...draft.items, r] })

  async function remove() {
    if (!window.confirm('Delete this draft quote?')) return
    const res = await fetch(`/api/hub/quotes/${quoteId}`, { method: 'DELETE' })
    if (res.ok) router.push('/hub/quotes')
    else setError((await res.json().catch(() => ({}))).error ?? 'Could not delete')
  }

  const section = (optional: boolean) => {
    const rows = draft.items.filter(r => r.optional === optional)
    return (
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-sm text-gray-500">{optional ? 'No add-ons. Add extras the customer can choose to tick.' : 'Nothing included yet.'}</div>}
        {rows.map((r, n) => {
          const needsPrice = r.unit_price.trim() === ''
          const total = (Number(r.quantity) || 0) * (Number(r.unit_price) || 0)
          return (
            <div key={r.key} className={`rounded-md border p-2 space-y-2 ${optional ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-white/10'}`}>
              <div className="grid grid-cols-12 gap-2">
                <input value={r.name} onChange={e => setRow(r.key, { name: e.target.value })} placeholder="Name" disabled={!isDraft}
                  className={`${inp} col-span-12 md:col-span-6`} />
                <input value={r.quantity} onChange={e => setRow(r.key, { quantity: e.target.value })} inputMode="decimal" disabled={!isDraft}
                  className={`${inp} col-span-3 md:col-span-2`} aria-label="Quantity" />
                <input value={r.unit_price} onChange={e => setRow(r.key, { unit_price: e.target.value })} inputMode="decimal" disabled={!isDraft}
                  placeholder="Price needed" aria-label="Unit price"
                  className={`${inp} col-span-5 md:col-span-2 ${needsPrice ? '!border-red-400/60' : ''}`} />
                <div className="col-span-4 md:col-span-2 text-right self-center text-sm text-gray-200">{needsPrice ? '—' : money(total)}</div>
              </div>
              <textarea value={r.description} onChange={e => setRow(r.key, { description: e.target.value })} rows={2} disabled={!isDraft}
                placeholder="Description the customer reads (optional)" className={`${inp} resize-y`} />
              {isDraft && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <button type="button" onClick={() => setRow(r.key, { optional: !r.optional, recommended: false })} className="text-gray-300 hover:text-white">
                    {optional ? 'Move to included' : 'Make it an add-on'}
                  </button>
                  {optional && (
                    <label className="flex items-center gap-1.5 text-gray-300">
                      <input type="checkbox" checked={r.recommended} onChange={e => setRow(r.key, { recommended: e.target.checked })} /> Show “Recommended”
                    </label>
                  )}
                  {r.pricer_ref && <span className="text-gray-500">From the Pricer</span>}
                  {r.jobber_product_id && <span className="text-gray-500">From Jobber</span>}
                  <span className="flex-1" />
                  <button type="button" onClick={() => moveRow(r.key, -1)} disabled={n === 0} className="text-gray-400 hover:text-white disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => moveRow(r.key, 1)} disabled={n === rows.length - 1} className="text-gray-400 hover:text-white disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => update({ items: draft.items.filter(x => x.key !== r.key) })} className="text-red-300 hover:text-red-200">Remove</button>
                </div>
              )}
            </div>
          )
        })}
        {isDraft && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPicker({ kind: 'pricer', optional })} className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white">+ From Pricer</button>
            <button type="button" onClick={() => setPicker({ kind: 'jobber', optional })} className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white">+ From Jobber</button>
            <button type="button" onClick={() => addRow(rowFrom({ optional }))} className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white">+ Blank line</button>
          </div>
        )}
      </div>
    )
  }

  const customerQuote = toCustomerQuote(
    {
      title: draft.title, intro: draft.intro, terms: draft.terms, property_address: property?.address ?? null,
      deposit_type: draft.deposit_type || null, deposit_value: draft.deposit_type ? Number(draft.deposit_value) : null,
      status: loaded.quote.status, sent_at: loaded.quote.sent_at, expires_at: loaded.quote.expires_at,
    },
    items, reviews, draft.review_ids, { company: loaded.companyName, customer: loaded.contact?.name ?? '' },
  )

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none px-3 md:px-6 pt-4 pb-3 border-b border-gray-800 max-md:pl-14">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Link href="/hub/quotes" className="text-xs text-gray-400 hover:text-white">← Quotes</Link>
            <h1 className="text-lg font-semibold text-white truncate">Quote for {loaded.contact?.name ?? 'customer'}</h1>
            <div className="text-xs text-gray-500">
              {STATUS_LABEL[loaded.quote.status]}
              {isDraft && <> · {saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'error' ? 'Not saved' : 'Saved'}</>}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPreview(true)} className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm text-white">Preview</button>
            {isDraft && <button type="button" onClick={remove} className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-red-200">Delete draft</button>}
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-3 md:px-6 py-4 space-y-4 pb-24">
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}
          {!isDraft && <div className="bg-sky-500/10 border border-sky-500/30 text-sky-200 rounded px-3 py-2 text-sm">This quote has been sent, so it can’t be changed here.</div>}

          <section className={card}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-white">{loaded.contact?.name}</div>
                <div className="text-xs text-gray-400">{[loaded.contact?.phone, loaded.contact?.email].filter(Boolean).join(' · ') || 'No phone or email on file'}</div>
                {loaded.contact?.doNotText && <div className="text-xs text-amber-300">Marked do-not-text — the quote can only go by email.</div>}
              </div>
              <Link href={`/hub/contacts/${loaded.quote.contact_id}`} className="text-xs text-sky-300 hover:text-sky-200 shrink-0">Customer file ›</Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block md:col-span-2">
                <span className={lbl}>Property</span>
                <select value={draft.property_key} disabled={!isDraft} className={inp}
                  onChange={e => {
                    const p = loaded.properties.find(x => propKey(x) === e.target.value)
                    update({ property_key: e.target.value, lawn_size_k: p?.lawnK != null ? String(p.lawnK) : draft.lawn_size_k })
                  }}>
                  {!draft.property_key && <option value="">No property</option>}
                  {loaded.properties.map(p => <option key={propKey(p)} value={propKey(p)}>{p.address || '(no address)'}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={lbl}>Lawn size (K sq ft)</span>
                <input value={draft.lawn_size_k} onChange={e => update({ lawn_size_k: e.target.value })} inputMode="decimal" disabled={!isDraft}
                  placeholder="e.g. 8.5" className={inp} />
              </label>
            </div>
            {property && property.lawnK == null && <div className="text-[12px] text-gray-500">No lawn size on file for this property — measure it with the Lawn Sizer and type it in.</div>}
          </section>

          <section className={card}>
            <label className="block">
              <span className={lbl}>Title (the customer sees this at the top)</span>
              <input value={draft.title} onChange={e => update({ title: e.target.value })} disabled={!isDraft} placeholder="e.g. Your lawn care plan" className={inp} />
            </label>
            <label className="block">
              <span className={lbl}>Intro</span>
              <textarea value={draft.intro} onChange={e => update({ intro: e.target.value })} rows={4} disabled={!isDraft}
                placeholder="A few friendly lines for this customer." className={`${inp} resize-y`} />
            </label>
          </section>

          <section className={card}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-white">What’s included</h2>
              <span className="text-sm text-gray-300">{money(totals.required)}</span>
            </div>
            {section(false)}
          </section>

          <section className={card}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-white">Add-ons — optional</h2>
              <span className="text-sm text-gray-400">up to {money(totals.addOns)}</span>
            </div>
            <p className="text-[12px] text-gray-500 -mt-2">The customer sees these unticked and chooses which to add.</p>
            {section(true)}
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold text-white">Deposit</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select value={draft.deposit_type} disabled={!isDraft} onChange={e => update({ deposit_type: e.target.value as Draft['deposit_type'] })} className={`${inp} w-auto`}>
                <option value="">No deposit</option>
                <option value="percent">Percent of the total</option>
                <option value="fixed">Fixed amount</option>
              </select>
              {draft.deposit_type && (
                <div className="flex items-center gap-1">
                  {draft.deposit_type === 'fixed' && <span className="text-gray-400">$</span>}
                  <input value={draft.deposit_value} onChange={e => update({ deposit_value: e.target.value })} inputMode="decimal" disabled={!isDraft} className={`${inp} w-28`} />
                  {draft.deposit_type === 'percent' && <span className="text-gray-400">%</span>}
                </div>
              )}
              {deposit != null && totals.required > 0 && <span className="text-[13px] text-gray-400">= {money(deposit)} on {money(totals.required)}</span>}
            </div>
            {draft.deposit_type && <p className="text-[12px] text-gray-500">Paid on Jobber’s payment page — the customer gets a <em>Pay deposit</em> button after approving.</p>}
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold text-white">Reviews <span className="text-gray-500 font-normal">({draft.review_ids.length} of {MAX_QUOTE_REVIEWS})</span></h2>
            {reviews.length === 0 ? (
              <p className="text-[12px] text-gray-500">No reviews yet — a Quotes admin adds them in Admin → Quotes → Reviews.</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {reviews.map(r => {
                  const on = draft.review_ids.includes(r.id)
                  const full = !on && draft.review_ids.length >= MAX_QUOTE_REVIEWS
                  return (
                    <label key={r.id} className={`flex items-start gap-2 rounded-md p-2 border ${on ? 'border-indigo-400/40 bg-indigo-500/10' : 'border-white/5'} ${full || !isDraft ? 'opacity-40' : 'cursor-pointer'}`}>
                      <input type="checkbox" className="mt-1" checked={on} disabled={full || !isDraft}
                        onChange={() => update({ review_ids: on ? draft.review_ids.filter(x => x !== r.id) : [...draft.review_ids, r.id] })} />
                      <span className="min-w-0">
                        <span className="block text-sm text-white">{r.author} <span className="text-amber-300">{'★'.repeat(r.rating)}</span></span>
                        <span className="block text-[12px] text-gray-400 line-clamp-2">{r.body}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </section>

          <section className={card}>
            <label className="block">
              <span className={lbl}>Terms</span>
              <textarea value={draft.terms} onChange={e => update({ terms: e.target.value })} rows={5} disabled={!isDraft} className={`${inp} resize-y`} />
            </label>
          </section>

          <section className="rounded-lg border border-amber-400/30 bg-amber-400/[0.05] p-3 space-y-2">
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-amber-300 mb-1">Internal notes — never shown to the customer</span>
              <textarea value={draft.internal_notes} onChange={e => update({ internal_notes: e.target.value })} rows={3} disabled={!isDraft}
                placeholder="Gate on the left; dog in the back; quoted low for a neighbor referral…" className={`${inp} resize-y`} />
            </label>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-gray-300">
              Total <span className="text-white font-semibold">{money(totals.required)}</span>
              {totals.addOns > 0 && <> · add-ons up to {money(totals.addOns)}</>}
              {unpriced > 0 && <span className="block text-[12px] text-red-300">{unpriced} line{unpriced === 1 ? '' : 's'} still need{unpriced === 1 ? 's' : ''} a price.</span>}
            </div>
            <div className="text-[12px] text-gray-500">Sending by text / email is coming in the next update.</div>
          </section>
        </div>
      </div>

      {picker && (
        <LinePicker
          kind={picker.kind}
          optional={picker.optional}
          lawnK={Number(draft.lawn_size_k) || null}
          zones={property?.zones ?? null}
          onPick={r => { addRow(r); setPicker(null) }}
          onClose={() => setPicker(null)}
        />
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex flex-col" role="dialog" aria-modal="true">
          <div className="flex-none flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
            <span className="text-sm text-gray-300">Preview — what {loaded.contact?.name ?? 'the customer'} will see</span>
            <button type="button" onClick={() => setPreview(false)} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white">Close</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto bg-white">
            <CustomerQuoteView quote={customerQuote} mode="preview" />
          </div>
        </div>
      )}
    </div>
  )
}

function LinePicker({ kind, optional, lawnK, zones, onPick, onClose }: {
  kind: 'jobber' | 'pricer'
  optional: boolean
  lawnK: number | null
  zones: number | null
  onPick: (r: Row) => void
  onClose: () => void
}) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [programs, setPrograms] = useState<PricerProgram[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [size, setSize] = useState(lawnK != null ? String(lawnK) : '')
  const [zoneCount, setZoneCount] = useState(zones != null ? String(zones) : '')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(kind === 'jobber' ? '/api/hub/quotes/catalog' : '/api/hub/quotes/pricer', { cache: 'no-store' })
      const j = await res.json()
      if (cancelled) return
      if (!res.ok) setErr(j.error ?? 'Could not load')
      else if (kind === 'jobber') setProducts(j.products)
      else setPrograms(j.programs)
    })()
    return () => { cancelled = true }
  }, [kind])

  const q = search.trim().toLowerCase()
  const productMatches = (products ?? []).filter(p => !q || p.name.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q)).slice(0, 60)
  const programMatches = (programs ?? []).filter(p => !q || p.name.toLowerCase().includes(q))

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full md:max-w-lg max-h-[85vh] flex flex-col bg-gray-900 border border-gray-700 rounded-t-xl md:rounded-xl" onClick={e => e.stopPropagation()}>
        <div className="flex-none p-3 border-b border-gray-800 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{kind === 'jobber' ? 'Add from Jobber' : 'Add from the Pricer'}{optional ? ' — as an add-on' : ''}</h3>
            <button type="button" onClick={onClose} className="text-sm text-gray-400 hover:text-white">Close</button>
          </div>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" className={inp} />
          {kind === 'pricer' && (
            <div className="flex gap-2">
              <label className="flex-1">
                <span className={lbl}>Lawn size (K sq ft)</span>
                <input value={size} onChange={e => setSize(e.target.value)} inputMode="decimal" placeholder="e.g. 8.5" className={inp} />
              </label>
              <label className="w-28">
                <span className={lbl}>Zones</span>
                <input value={zoneCount} onChange={e => setZoneCount(e.target.value)} inputMode="numeric" className={inp} />
              </label>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/5">
          {err && <div className="p-3 text-sm text-red-300">{err}</div>}
          {!err && kind === 'jobber' && !products && <div className="p-3 text-sm text-gray-500">Reading Jobber…</div>}
          {!err && kind === 'pricer' && !programs && <div className="p-3 text-sm text-gray-500">Loading price charts…</div>}
          {kind === 'jobber' && productMatches.map(p => (
            <button key={p.id} type="button" className="w-full text-left p-3 hover:bg-white/5 flex justify-between gap-3"
              onClick={() => onPick(rowFrom({ name: p.name, description: p.description ?? '', quantity: 1, unit_price: p.price || null, optional, jobber_product_id: p.id }))}>
              <span className="min-w-0">
                <span className="block text-sm text-white truncate">{p.name}</span>
                {p.category && <span className="block text-[11px] text-gray-500">{p.category}</span>}
              </span>
              <span className="text-sm text-gray-300 shrink-0">{p.price ? money(p.price) : 'Price needed'}</span>
            </button>
          ))}
          {kind === 'pricer' && programMatches.map(p => {
            const input = p.pricing_unit === 'zones' ? Number(zoneCount) : Number(size)
            const ready = Number.isFinite(input) && input > 0
            const perVisit = ready ? perVisitAt(p, input) : 0
            const visits = p.visits > 0 ? p.visits : 1
            return (
              <button key={p.program_key} type="button" disabled={!ready} className="w-full text-left p-3 hover:bg-white/5 disabled:opacity-50 flex justify-between gap-3"
                onClick={() => { const l = pricerLine(p, input, perVisit); onPick(rowFrom({ ...l, optional: optional || p.category === 'addon' })) }}>
                <span className="min-w-0">
                  <span className="block text-sm text-white">{p.name}</span>
                  <span className="block text-[11px] text-gray-500">
                    {p.pricing_unit === 'zones' ? 'Priced by zones' : 'Priced by lawn size'}{visits > 1 ? ` · ${visits} visits` : ''}{p.category === 'addon' ? ' · add-on' : ''}
                  </span>
                </span>
                <span className="text-sm text-gray-300 shrink-0 text-right">
                  {ready ? <>{money(perVisit * visits)}{visits > 1 && <span className="block text-[11px] text-gray-500">{money(perVisit)} / visit</span>}</> : p.pricing_unit === 'zones' ? 'Enter zones' : 'Enter lawn size'}
                </span>
              </button>
            )
          })}
          {kind === 'pricer' && programs && programMatches.length === 0 && <div className="p-3 text-sm text-gray-500">No published programs match.</div>}
        </div>
      </div>
    </div>
  )
}
