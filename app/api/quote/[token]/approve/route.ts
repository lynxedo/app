import { NextResponse, after } from 'next/server'
import { syncApprovalToJobber } from '@/lib/quote-jobber'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadPublicQuote, notifyQuoteAnswer, quoteByToken, requestIp } from '@/lib/quote-public'
import { effectiveStatus, quoteTotals, validApprovalName, type QuoteItem } from '@/lib/quotes'

// POST /api/quote/:token/approve { name, picked: string[] }
// The customer approves by typing their name (Ben, Oct 5 2026), with the
// add-ons they ticked. Records name + time + IP + browser, marks the picked
// add-ons, stores the agreed total, then tells the team. Public (token = key).
// Only a live quote (sent / viewed / changes requested, not past 30 days).

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const q = await quoteByToken(admin, token)
  if (!q) return NextResponse.json({ error: 'This quote link isn’t valid.' }, { status: 404 })
  const status = effectiveStatus(q)
  if (status === 'approved') return NextResponse.json({ error: 'This quote is already approved.' }, { status: 409 })
  if (status === 'expired') return NextResponse.json({ error: 'This quote has expired. Please contact us for an updated one.' }, { status: 409 })
  if (!['sent', 'viewed', 'changes_requested'].includes(status)) return NextResponse.json({ error: 'This quote can’t be approved.' }, { status: 409 })

  const body = await request.json().catch(() => ({})) as { name?: unknown; picked?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!validApprovalName(name)) return NextResponse.json({ error: 'Please type your full name to approve.' }, { status: 400 })

  const { data: rows } = await admin.from('quote_line_items').select('id, name, optional, quantity, unit_price').eq('quote_id', q.id)
  const items = (rows ?? []) as (QuoteItem & { id: string })[]
  const optionalIds = new Set(items.filter(i => i.optional).map(i => i.id))
  const picked = new Set(Array.isArray(body.picked) ? body.picked.filter((x): x is string => typeof x === 'string' && optionalIds.has(x)) : [])
  const totals = quoteTotals(items, picked)
  const now = new Date().toISOString()

  // Guarded on status so two taps (or two tabs) can't approve twice.
  const { data: done, error } = await admin.from('quotes').update({
    status: 'approved',
    approved_at: now,
    approved_name: name,
    approved_ip: requestIp(request.headers),
    approved_user_agent: (request.headers.get('user-agent') ?? '').slice(0, 400) || null,
    total_selected: totals.selected,
    updated_at: now,
  }).eq('id', q.id).in('status', ['sent', 'viewed', 'changes_requested']).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: 'Something went wrong — please try again.' }, { status: 500 })
  if (!done) return NextResponse.json({ error: 'This quote was just updated — please reload the page.' }, { status: 409 })

  if (optionalIds.size) {
    await admin.from('quote_line_items').update({ selected_by_customer: false }).eq('quote_id', q.id).eq('optional', true)
    if (picked.size) await admin.from('quote_line_items').update({ selected_by_customer: true }).eq('quote_id', q.id).in('id', Array.from(picked))
  }
  await admin.from('quote_events').insert({
    quote_id: q.id, company_id: q.company_id, kind: 'approved',
    meta: { name, picked: Array.from(picked), total_selected: totals.selected },
  })

  const fresh = await quoteByToken(admin, token)
  const view = fresh ? await loadPublicQuote(admin, fresh) : null
  await notifyQuoteAnswer(admin, q, 'approved', {
    customer: view?.quote.customerName || name,
    total: totals.selected,
    addOns: items.filter(i => picked.has(i.id)).map(i => i.name),
  })
  // Jobber: picked add-ons become regular lines + a pinned approval note,
  // after the customer has their answer.
  after(async () => { await syncApprovalToJobber(createAdminClient(), q.company_id, q.id) })
  return NextResponse.json({ ok: true, view })
}
