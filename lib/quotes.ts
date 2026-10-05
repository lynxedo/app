// Work Orders & Quotes PRD — Phase 4 (Quotes). Pure module: imported by the
// builder, the customer page and the server routes (no Node built-ins).
//
// Ben's rules (Oct 5 2026): the customer approves by typing their name; a
// deposit is optional (percent or fixed amount, set per template / per quote);
// a quote expires 30 days after it is sent; add-ons are unticked until the
// customer ticks them (Sep 30 2026).

import type { PriceTier } from '@/lib/service-builder'

export const QUOTE_EXPIRY_DAYS = 30

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'changes_requested' | 'expired' | 'archived'

export type DepositType = 'percent' | 'fixed'

export type QuoteItem = {
  id?: string
  name: string
  description?: string
  quantity: number
  /** null = not priced yet (a template line marked "priced on each quote"). */
  unit_price: number | null
  /** An add-on: the customer may tick it. Unticked by default. */
  optional: boolean
  recommended?: boolean
  jobber_product_id?: string | null
  selected_by_customer?: boolean
}

const cents = (n: number) => Math.round(n * 100) / 100

export function lineTotal(i: Pick<QuoteItem, 'quantity' | 'unit_price'>): number {
  const q = Number(i.quantity), p = Number(i.unit_price)
  return Number.isFinite(q) && Number.isFinite(p) ? cents(q * p) : 0
}

/**
 * The quote's totals. `required` = every non-optional item. `selected` =
 * required + the add-ons in `picked` (ids, or `selected_by_customer` when no
 * set is given) — what the customer is agreeing to.
 */
export function quoteTotals(items: QuoteItem[], picked?: Set<string>): { required: number; optional: number; selected: number } {
  let required = 0, optional = 0, selected = 0
  for (const i of items) {
    const t = lineTotal(i)
    if (!i.optional) { required += t; selected += t; continue }
    optional += t
    const isPicked = picked ? (i.id ? picked.has(i.id) : false) : !!i.selected_by_customer
    if (isPicked) selected += t
  }
  return { required: cents(required), optional: cents(optional), selected: cents(selected) }
}

/** The deposit on a total, or null when the quote asks for none. Never more than the total. */
export function depositAmount(total: number, type: DepositType | null | undefined, value: number | null | undefined): number | null {
  if (!type || value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return null
  const v = Number(value)
  const amt = type === 'percent' ? cents(total * Math.min(v, 100) / 100) : cents(v)
  return Math.min(amt, cents(total))
}

/** When a quote sent at `sentAt` expires (30 days later — Ben). */
export function expiryFrom(sentAt: Date | string): string {
  const d = new Date(sentAt)
  d.setDate(d.getDate() + QUOTE_EXPIRY_DAYS)
  return d.toISOString()
}

/**
 * The status a reader should act on: a sent/viewed quote past its expiry is
 * expired even before anything has stamped it so. Approved / changes requested
 * / archived stay as they are.
 */
export function effectiveStatus(q: { status: QuoteStatus; expires_at: string | null }, now: Date = new Date()): QuoteStatus {
  if ((q.status === 'sent' || q.status === 'viewed') && q.expires_at && new Date(q.expires_at) <= now) return 'expired'
  return q.status
}

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  expired: 'Expired',
  archived: 'Archived',
}

/** A typed approval name must look like a name (Ben: typed name, not a signature). */
export function validApprovalName(name: string): boolean {
  const n = name.trim()
  return n.length >= 2 && n.length <= 120 && /[A-Za-z]/.test(n)
}

/**
 * One starting line on a template (Ben builds his own templates — Oct 5 2026).
 * `unit_price` null = "priced on each quote" (e.g. by lawn size); the builder
 * asks for it. Copied onto a quote when the template is picked — a later edit
 * to the template never changes a quote already made.
 */
export type TemplateItem = {
  jobber_product_id: string | null
  name: string
  description: string
  quantity: number
  unit_price: number | null
  optional: boolean
  recommended: boolean
}

export const MAX_TEMPLATE_ITEMS = 40
export const MAX_QUOTE_REVIEWS = 3

/** Validate + trim template lines from a request body; drops blank rows. */
export function cleanTemplateItems(raw: unknown): TemplateItem[] | string {
  if (raw == null) return []
  if (!Array.isArray(raw)) return 'Line items must be a list'
  const out: TemplateItem[] = []
  for (const r of raw.slice(0, MAX_TEMPLATE_ITEMS)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 200) : ''
    if (!name) continue
    const qty = Number(o.quantity)
    const priceRaw = o.unit_price
    const price = priceRaw === null || priceRaw === '' || priceRaw === undefined ? null : Number(priceRaw)
    if (price !== null && (!Number.isFinite(price) || price < 0)) return `“${name}”: the price must be a number (or blank to set it on each quote)`
    out.push({
      jobber_product_id: typeof o.jobber_product_id === 'string' && o.jobber_product_id ? o.jobber_product_id.slice(0, 200) : null,
      name,
      description: typeof o.description === 'string' ? o.description.trim().slice(0, 2000) : '',
      quantity: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 100000) : 1,
      unit_price: price === null ? null : cents(price),
      optional: o.optional === true,
      recommended: o.optional === true && o.recommended === true,
    })
  }
  return out
}

/** Validate a deposit pair from a request body. Both null = no deposit. */
export function cleanDeposit(type: unknown, value: unknown): { deposit_type: DepositType | null; deposit_value: number | null } | string {
  if (type == null || type === '' || type === 'none') return { deposit_type: null, deposit_value: null }
  if (type !== 'percent' && type !== 'fixed') return 'Deposit must be a percent or a fixed amount'
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return 'Enter the deposit amount'
  if (type === 'percent' && v > 100) return 'A percent deposit cannot be more than 100%'
  return { deposit_type: type, deposit_value: cents(v) }
}

/** Lines still waiting for a price — a quote can't be sent while any remain. */
export function unpricedItems<T extends Pick<QuoteItem, 'unit_price'>>(items: T[]): T[] {
  return items.filter(i => i.unit_price == null || !Number.isFinite(Number(i.unit_price)))
}

// --- Insert from Pricer -------------------------------------------------------

export type PricerProgram = {
  program_key: string
  name: string
  description: string | null
  category: string
  visits: number
  base_fee: number
  price_per_k: number
  pricing_unit: 'sqft_k' | 'zones'
  tiers: PriceTier[] | null
  version_label: string | null
}

/**
 * A quote line for a Pricer program at `input` (lawn size in K, or zones):
 * quantity = the program's visits, unit price = the per-visit price, so the
 * line total is the program's annual price — the same numbers the Pricer shows.
 */
export function pricerLine(p: PricerProgram, input: number, perVisit: number): Omit<QuoteItem, 'id' | 'optional'> & { pricer_ref: Record<string, unknown> } {
  const visits = p.visits > 0 ? p.visits : 1
  const unit = p.pricing_unit === 'zones' ? `${input} zone${input === 1 ? '' : 's'}` : `${input.toLocaleString('en-US', { maximumFractionDigits: 1 })}K sq ft`
  return {
    name: p.name,
    description: [p.description?.trim(), `Priced for ${unit}${visits > 1 ? ` · ${visits} visits` : ''}.`].filter(Boolean).join('\n'),
    quantity: visits,
    unit_price: cents(perVisit),
    jobber_product_id: null,
    recommended: false,
    pricer_ref: { program_key: p.program_key, version_label: p.version_label, input, pricing_unit: p.pricing_unit, per_visit: cents(perVisit), visits },
  }
}

// --- What the customer sees (allowlist) ---------------------------------------
// Built field by field — internal notes, Jobber ids, Pricer refs, who made it
// and anything else on the quote row never reach the customer page or preview.

export type CustomerQuoteItem = {
  id: string
  name: string
  description: string
  quantity: number
  unit_price: number
  total: number
  optional: boolean
  recommended: boolean
}

export type CustomerQuote = {
  companyName: string
  customerName: string
  propertyAddress: string
  title: string
  intro: string
  terms: string
  items: CustomerQuoteItem[]
  reviews: { author: string; rating: number; body: string; source: string; review_date: string | null }[]
  deposit: { type: DepositType; value: number } | null
  status: QuoteStatus
  sentAt: string | null
  expiresAt: string | null
}

export function toCustomerQuote(q: {
  title: string; intro: string; terms: string; property_address: string | null
  deposit_type: DepositType | null; deposit_value: number | null
  status: QuoteStatus; sent_at: string | null; expires_at: string | null
}, items: QuoteItem[], reviews: { id: string; author: string; rating: number; body: string; source: string; review_date: string | null }[], reviewIds: string[], names: { company: string; customer: string }): CustomerQuote {
  const byId = new Map(reviews.map(r => [r.id, r]))
  return {
    companyName: names.company,
    customerName: names.customer,
    propertyAddress: q.property_address ?? '',
    title: q.title,
    intro: q.intro,
    terms: q.terms,
    items: items.map((i, n) => ({
      id: i.id ?? `i${n}`,
      name: i.name,
      description: i.description ?? '',
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price ?? 0),
      total: lineTotal(i),
      optional: !!i.optional,
      recommended: !!i.optional && !!i.recommended,
    })),
    reviews: reviewIds.map(id => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).slice(0, MAX_QUOTE_REVIEWS)
      .map(r => ({ author: r.author, rating: r.rating, body: r.body, source: r.source, review_date: r.review_date })),
    deposit: q.deposit_type && q.deposit_value != null ? { type: q.deposit_type, value: Number(q.deposit_value) } : null,
    status: effectiveStatus({ status: q.status, expires_at: q.expires_at }),
    sentAt: q.sent_at,
    expiresAt: q.expires_at,
  }
}
