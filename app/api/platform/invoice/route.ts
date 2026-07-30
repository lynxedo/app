import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { stripeConfigured } from '@/lib/billing/stripe'
import { getBillingMode } from '@/lib/billing/catalog'
import { createManualInvoice } from '@/lib/billing/invoice'
import { logPlatformAction } from '@/lib/billing/audit'

// Platform super-admin: create a one-off Stripe Invoice for a tenant from selected usage/
// fee lines. `send=false` leaves it a draft (review in Stripe); `send=true` finalizes +
// emails the hosted invoice to the customer. Amounts are recomputed server-side — the
// client only chooses which line ids to bill. 503 while Stripe is unconfigured (dark).
//
// Body: { company_id, from, to, included_line_ids[], recipient_email, due_days?, memo?, send? }
export async function POST(request: Request) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 })
  }

  const body = (await request.json().catch(() => null)) as {
    company_id?: string
    from?: string
    to?: string
    included_line_ids?: unknown
    recipient_email?: string
    due_days?: number
    memo?: string
    send?: boolean
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : ''
  const from = typeof body.from === 'string' ? body.from.trim() : ''
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  const recipientEmail = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : ''
  const includedLineIds = Array.isArray(body.included_line_ids)
    ? body.included_line_ids.filter((x): x is string => typeof x === 'string')
    : []
  const send = body.send === true
  const dueDaysRaw = Number(body.due_days)
  const dueDays = Number.isFinite(dueDaysRaw) ? Math.min(90, Math.max(1, Math.round(dueDaysRaw))) : 14

  if (!companyId || !from || !to) {
    return NextResponse.json({ error: 'company_id, from and to are required.' }, { status: 400 })
  }
  if (includedLineIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one line to bill.' }, { status: 400 })
  }
  if (!recipientEmail || !recipientEmail.includes('@')) {
    return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    const result = await createManualInvoice(admin, getBillingMode(), {
      companyId,
      from,
      to,
      includedLineIds,
      recipientEmail,
      dueDays,
      memo: typeof body.memo === 'string' ? body.memo : undefined,
      send,
    })
    await logPlatformAction(admin, gate.userId, 'create_invoice', companyId, {
      invoice_id: result.invoiceId,
      sent: send,
      line_count: result.lineCount,
      from,
      to,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
