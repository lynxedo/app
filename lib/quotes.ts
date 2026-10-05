// Work Orders & Quotes PRD — Phase 4 (Quotes). Pure module: imported by the
// builder, the customer page and the server routes (no Node built-ins).
//
// Ben's rules (Oct 5 2026): the customer approves by typing their name; a
// deposit is optional (percent or fixed amount, set per template / per quote);
// a quote expires 30 days after it is sent; add-ons are unticked until the
// customer ticks them (Sep 30 2026).

export const QUOTE_EXPIRY_DAYS = 30

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'changes_requested' | 'expired' | 'archived'

export type DepositType = 'percent' | 'fixed'

export type QuoteItem = {
  id?: string
  name: string
  description?: string
  quantity: number
  unit_price: number
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
