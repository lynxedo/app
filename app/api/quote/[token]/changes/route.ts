import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadPublicQuote, notifyQuoteAnswer, quoteByToken } from '@/lib/quote-public'
import { effectiveStatus } from '@/lib/quotes'

// POST /api/quote/:token/changes { message }
// The customer asks for changes instead of approving. Saved on the quote and
// sent to the team (salesperson DM + Office Alerts). They can still approve
// afterwards. Public (token = key).

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const q = await quoteByToken(admin, token)
  if (!q) return NextResponse.json({ error: 'This quote link isn’t valid.' }, { status: 404 })
  const status = effectiveStatus(q)
  if (status === 'approved') return NextResponse.json({ error: 'This quote is already approved — please call us to change it.' }, { status: 409 })
  if (status === 'expired') return NextResponse.json({ error: 'This quote has expired. Please contact us for an updated one.' }, { status: 409 })

  const body = await request.json().catch(() => ({})) as { message?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : ''
  if (message.length < 3) return NextResponse.json({ error: 'Tell us what you’d like changed.' }, { status: 400 })

  const now = new Date().toISOString()
  const { data: done } = await admin.from('quotes').update({
    status: 'changes_requested', changes_message: message, changes_requested_at: now, updated_at: now,
  }).eq('id', q.id).in('status', ['sent', 'viewed', 'changes_requested']).select('id').maybeSingle()
  if (!done) return NextResponse.json({ error: 'This quote was just updated — please reload the page.' }, { status: 409 })
  await admin.from('quote_events').insert({ quote_id: q.id, company_id: q.company_id, kind: 'changes_requested', meta: { message } })

  const fresh = await quoteByToken(admin, token)
  const view = fresh ? await loadPublicQuote(admin, fresh) : null
  await notifyQuoteAnswer(admin, q, 'changes', { customer: view?.quote.customerName || 'The customer', message })
  return NextResponse.json({ ok: true, view })
}
