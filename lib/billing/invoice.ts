// Manual (one-off) invoicing (Track 5 — manual billing path).
//
// Instead of Stripe auto-charging a subscription, the platform admin pulls a tenant's
// usage for a period, reviews the itemized lines, and creates a one-off Stripe Invoice
// (Stripe Invoicing) that Stripe emails to the customer with a hosted "Pay now" page.
//
// Lines are computed from the SAME source of truth as everything else: the pricing
// catalog (flat fees) + the usage counter RPCs (metered usage). Amounts round to whole
// cents per line for the invoice.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe } from './stripe'
import { getOrCreateStripeCustomer } from './subscription'
import { listCatalog } from './catalog'
import type { BillingMode } from './types'

type Admin = SupabaseClient<any, any, any>

// meter_event_name → counting RPC. Mirror of USAGE_RPC in usage-report.ts (keep in sync).
const USAGE_RPC: Record<string, string> = {
  call_minutes: 'billing_usage_dialer_minutes',
  ai_minutes: 'billing_usage_ai_minutes',
  text_messages: 'billing_usage_text_count',
  recording_minutes: 'billing_usage_recording_minutes',
  transcript_minutes: 'billing_usage_transcript_minutes',
  ai_summaries: 'billing_usage_ai_summaries',
  caller_id_lookups: 'billing_usage_caller_id_lookups',
  assistant_requests: 'billing_usage_assistant_requests',
}

export type InvoiceLine = {
  id: string // stable per (feature, kind) so the client can select which lines to bill
  feature_key: string
  label: string
  kind: 'base' | 'flat' | 'usage'
  quantity: number | null
  unit: string | null
  unit_price_cents: number | null
  amount_cents: number
  default_included: boolean
}

// Compute every billable line for a company over [from, to): the base fee, each active
// billable add-on's flat monthly fee (if any), and each metered add-on's usage
// (quantity × per-unit rate). Metered items can yield two lines (flat + usage).
export async function computeInvoiceLines(
  admin: Admin,
  companyId: string,
  from: string,
  to: string,
): Promise<InvoiceLine[]> {
  const features = await listCatalog(admin)
  const lines: InvoiceLine[] = []

  const base = features.find((f) => f.is_base && f.active)
  if (base) {
    lines.push({
      id: `${base.feature_key}:base`,
      feature_key: base.feature_key,
      label: base.label,
      kind: 'base',
      quantity: null,
      unit: null,
      unit_price_cents: null,
      amount_cents: base.default_price_cents ?? 0,
      default_included: true,
    })
  }

  const addOns = features.filter((f) => !f.is_base && !f.included_in_base && f.active)
  for (const f of addOns) {
    // Flat monthly fee (if the item carries one).
    if ((f.default_price_cents ?? 0) > 0) {
      lines.push({
        id: `${f.feature_key}:flat`,
        feature_key: f.feature_key,
        label: f.label,
        kind: 'flat',
        quantity: null,
        unit: null,
        unit_price_cents: null,
        amount_cents: f.default_price_cents ?? 0,
        default_included: false, // the admin ticks the modules this tenant is on
      })
    }
    // Metered usage line.
    if (f.metered) {
      const rpc = USAGE_RPC[f.meter_event_name ?? '']
      let qty = 0
      if (rpc) {
        const { data } = await admin.rpc(rpc, { p_company: companyId, p_from: from, p_to: to })
        qty = Number((data as unknown as number | string | null) ?? 0)
      }
      const rate = f.unit_price_cents == null ? 0 : Number(f.unit_price_cents)
      lines.push({
        id: `${f.feature_key}:usage`,
        feature_key: f.feature_key,
        label: f.label,
        kind: 'usage',
        quantity: qty,
        unit: f.usage_unit ?? 'unit',
        unit_price_cents: rate,
        amount_cents: Math.round(qty * rate),
        default_included: qty > 0,
      })
    }
  }

  return lines
}

// Human-readable period label for line descriptions, e.g. "Jul 1 – Jul 31, 2026".
function periodLabel(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  try {
    const a = new Date(from).toLocaleDateString('en-US', opts)
    const b = new Date(to).toLocaleDateString('en-US', opts)
    return `${a} – ${b}`
  } catch {
    return `${from} – ${to}`
  }
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// A description string for one invoice line item.
function lineDescription(l: InvoiceLine, period: string): string {
  if (l.kind === 'usage') {
    const rate = l.unit_price_cents == null ? 0 : l.unit_price_cents / 100
    return `${l.label} — ${l.quantity ?? 0} ${l.unit ?? 'unit'} × $${rate.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} (${period})`
  }
  if (l.kind === 'base') return `${l.label} (${period})`
  return `${l.label} — monthly (${period})`
}

// Create a one-off Stripe Invoice for a company from selected lines. When `send` is true
// the invoice is finalized + emailed to the customer (hosted "Pay now" page); otherwise it
// stays a draft the admin can review/send in Stripe. Returns the invoice id + status +
// hosted URL (null while draft). Recomputes lines server-side — the client only chooses
// which line ids to include, never the amounts.
export async function createManualInvoice(
  admin: Admin,
  mode: BillingMode,
  opts: {
    companyId: string
    from: string
    to: string
    includedLineIds: string[]
    recipientEmail: string
    dueDays: number
    memo?: string
    send: boolean
  },
): Promise<{ invoiceId: string; status: string; hostedUrl: string | null; lineCount: number }> {
  const stripe = getStripe()
  const allLines = await computeInvoiceLines(admin, opts.companyId, opts.from, opts.to)
  const included = new Set(opts.includedLineIds)
  const billLines = allLines.filter((l) => included.has(l.id) && l.amount_cents > 0)
  if (billLines.length === 0) throw new Error('No billable lines selected.')

  const customerId = await getOrCreateStripeCustomer(admin, opts.companyId, mode)
  // Make sure the invoice reaches the right inbox (skip when blank — e.g. a draft with no
  // recipient yet — so we never clear an existing customer email).
  if (opts.recipientEmail) {
    await stripe.customers.update(customerId, { email: opts.recipientEmail })
  }

  // Draft invoice first, then attach items to it (so no stray pending items sneak in).
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: opts.dueDays,
    description: opts.memo || undefined,
    auto_advance: false,
    metadata: { company_id: opts.companyId, mode, manual: 'true' },
  })

  const period = periodLabel(opts.from, opts.to)
  for (const l of billLines) {
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      currency: 'usd',
      amount: l.amount_cents,
      description: lineDescription(l, period),
    })
  }

  if (!opts.send) {
    return {
      invoiceId: invoice.id,
      status: invoice.status ?? 'draft',
      hostedUrl: invoice.hosted_invoice_url ?? null,
      lineCount: billLines.length,
    }
  }

  // Finalize + email the hosted invoice to the customer.
  const sent = await stripe.invoices.sendInvoice(invoice.id)
  return {
    invoiceId: sent.id,
    status: sent.status ?? 'open',
    hostedUrl: sent.hosted_invoice_url ?? null,
    lineCount: billLines.length,
  }
}
