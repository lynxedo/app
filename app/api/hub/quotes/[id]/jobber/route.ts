import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveQuoteCaller } from '@/lib/quote-access'
import { pushQuoteToJobber, syncApprovalToJobber } from '@/lib/quote-jobber'

// POST /api/hub/quotes/:id/jobber — Retry the Jobber step after it failed
// (e.g. the customer wasn't in Jobber yet). A sent quote with no Jobber quote
// is created there; an approved one also gets its approval (chosen add-ons +
// pinned note). Anyone who can build quotes.

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const { id } = await params
  const admin = createAdminClient()
  const { data: q } = await admin.from('quotes').select('id, status, jobber_quote_id')
    .eq('company_id', c.companyId).eq('id', id).is('deleted_at', null).maybeSingle()
  if (!q) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  if (q.status === 'draft') return NextResponse.json({ error: 'Send the quote first — it goes to Jobber when it’s sent.' }, { status: 409 })
  let err: string | null = null
  if (!q.jobber_quote_id) err = await pushQuoteToJobber(admin, c.companyId, id, c.userId)
  if (!err && q.status === 'approved') err = await syncApprovalToJobber(admin, c.companyId, id)
  if (err) return NextResponse.json({ error: err }, { status: 502 })
  return NextResponse.json({ ok: true })
}
