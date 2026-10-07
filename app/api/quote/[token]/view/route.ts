import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { quoteByToken } from '@/lib/quote-public'

// POST /api/quote/:token/view — the customer's page opened (called from the
// page's JavaScript, so a text app's link preview doesn't count as a view).
// Stamps first/last viewed; Sent → Viewed. Public (token is the key).

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const q = await quoteByToken(admin, token)
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const now = new Date().toISOString()
  const up: Record<string, unknown> = { last_viewed_at: now }
  if (!q.first_viewed_at) up.first_viewed_at = now
  await admin.from('quotes').update(up).eq('id', q.id)
  if (q.status === 'sent') {
    const { data } = await admin.from('quotes').update({ status: 'viewed' }).eq('id', q.id).eq('status', 'sent').select('id').maybeSingle()
    if (data) await admin.from('quote_events').insert({ quote_id: q.id, company_id: q.company_id, kind: 'viewed', meta: {} })
  }
  return NextResponse.json({ ok: true })
}
