import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessProfile } from '@/lib/business-profile'
import { contactDisplayName, ITEM_COLS } from '@/lib/quote-server'
import { toCustomerQuote, type CustomerQuote, type QuoteItem, type QuoteStatus, type DepositType } from '@/lib/quotes'

// The customer's side of a quote (Work Orders & Quotes PRD — Phase 4, session 4).
// Read by share token with the service-role client — the token (24 random
// bytes) is the only key, so every reader here returns the allowlisted
// CustomerQuote and nothing else. Drafts and deleted quotes are never served.

type Admin = ReturnType<typeof createAdminClient>

export const PUBLIC_QUOTE_COLS = 'id, company_id, contact_id, salesperson_user_id, created_by, title, intro, terms, property_address, review_ids, deposit_type, deposit_value, status, sent_at, expires_at, first_viewed_at, approved_at, approved_name, changes_message, changes_requested_at, total_required, total_selected, deleted_at'

export type PublicQuoteRow = {
  id: string
  company_id: string
  contact_id: string
  salesperson_user_id: string | null
  created_by: string | null
  title: string
  intro: string
  terms: string
  property_address: string | null
  review_ids: string[]
  deposit_type: DepositType | null
  deposit_value: number | null
  status: QuoteStatus
  sent_at: string | null
  expires_at: string | null
  first_viewed_at: string | null
  approved_at: string | null
  approved_name: string | null
  changes_message: string | null
  changes_requested_at: string | null
  total_required: number | null
  total_selected: number | null
  deleted_at: string | null
}

export const validToken = (t: string) => /^[A-Za-z0-9_-]{20,64}$/.test(t)

/** The quote row for a token, or null (bad token, draft, deleted). */
export async function quoteByToken(admin: Admin, token: string): Promise<PublicQuoteRow | null> {
  if (!validToken(token)) return null
  const { data } = await admin.from('quotes').select(PUBLIC_QUOTE_COLS).eq('share_token', token).maybeSingle()
  const q = data as PublicQuoteRow | null
  if (!q || q.deleted_at || q.status === 'draft') return null
  return q
}

export type PublicQuoteView = {
  quote: CustomerQuote
  /** What the customer already chose — shown read-only once approved. */
  approved: { name: string; at: string; pickedIds: string[]; total: number } | null
  changesRequestedAt: string | null
  business: { name: string; phone: string }
}

/** Everything the public page renders — allowlisted. */
export async function loadPublicQuote(admin: Admin, q: PublicQuoteRow): Promise<PublicQuoteView> {
  const [{ data: items }, { data: reviews }, { data: contact }, profile] = await Promise.all([
    admin.from('quote_line_items').select(ITEM_COLS).eq('quote_id', q.id).eq('company_id', q.company_id).order('sort_order'),
    q.review_ids?.length
      ? admin.from('company_reviews').select('id, author, rating, body, source, review_date').eq('company_id', q.company_id).in('id', q.review_ids)
      : Promise.resolve({ data: [] as { id: string; author: string; rating: number; body: string; source: string; review_date: string | null }[] }),
    admin.from('txt_contacts').select('name, first_name, last_name, company_name, phone').eq('id', q.contact_id).maybeSingle(),
    getBusinessProfile(admin, q.company_id),
  ])
  const rows = (items ?? []) as (QuoteItem & { id: string; selected_by_customer: boolean })[]
  const quote = toCustomerQuote(q, rows, reviews ?? [], q.review_ids ?? [], {
    company: profile.businessName,
    customer: contact ? contactDisplayName(contact) : '',
  })
  return {
    quote,
    approved: q.status === 'approved' && q.approved_at
      ? { name: q.approved_name ?? '', at: q.approved_at, pickedIds: rows.filter(r => r.optional && r.selected_by_customer).map(r => r.id), total: Number(q.total_selected ?? 0) }
      : null,
    changesRequestedAt: q.status === 'changes_requested' ? q.changes_requested_at : null,
    business: { name: profile.businessName, phone: profile.phone },
  }
}

/** The caller's IP as seen through Cloudflare → the tunnel. */
export function requestIp(headers: Headers): string | null {
  return headers.get('cf-connecting-ip') || headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || null
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/**
 * Tell the team the customer answered: a Hub DM to whoever sent the quote (the
 * salesperson, else its creator) and a post in Office Alerts with the detail in
 * the thread. Best-effort — the customer's answer is already saved.
 */
export async function notifyQuoteAnswer(admin: Admin, q: PublicQuoteRow, kind: 'approved' | 'changes', detail: { customer: string; total?: number; addOns?: string[]; message?: string }) {
  const { postGuardianToUserDm } = await import('@/lib/guardian-post')
  const { postOfficeAlert } = await import('@/lib/office-alerts')
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com'
  const link = `${base}/hub/quotes/${q.id}`
  const head = kind === 'approved'
    ? `✅ ${detail.customer} approved the quote “${q.title || 'Quote'}”${detail.total != null ? ` — ${money(detail.total)}` : ''}`
    : `✏️ ${detail.customer} asked for changes to the quote “${q.title || 'Quote'}”`
  const lines = [
    kind === 'approved' && detail.addOns?.length ? `Add-ons chosen: ${detail.addOns.join(', ')}` : kind === 'approved' ? 'No add-ons chosen.' : null,
    kind === 'changes' && detail.message ? `“${detail.message}”` : null,
    kind === 'approved' ? 'Next: approve it in Jobber and book the work.' : 'Next: call or text them, then revise the quote.',
    link,
  ]
  const who = q.salesperson_user_id || q.created_by
  await Promise.allSettled([
    who ? postGuardianToUserDm(q.company_id, who, [head, ...lines.filter(Boolean)].join('\n'), { admin }) : Promise.resolve(null),
    postOfficeAlert(admin, q.company_id, { title: head, details: lines }),
  ])
}
