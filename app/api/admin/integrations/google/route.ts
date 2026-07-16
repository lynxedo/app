import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Per-company Google Local Services (LSA) poller config. The Google account is
// connected via /api/auth/google; here the Integrations admin sets which Local
// Services / Google Ads account id the poller pulls leads from, and toggles the
// poll on/off. (The manager/MCC + developer token are platform env, not here.)
export async function POST(request: Request) {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = (await request.json().catch(() => ({}))) as {
    customer_id?: string
    lsa_enabled?: boolean
  }
  const admin = createAdminClient()

  // Must be connected first (a google_connections row exists).
  const { data: conn } = await admin
    .from('google_connections')
    .select('company_id')
    .eq('company_id', check.company_id)
    .maybeSingle()
  if (!conn) {
    return NextResponse.json({ error: 'Connect your Google account first.' }, { status: 400 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.customer_id !== undefined) {
    const d = body.customer_id.replace(/\D/g, '')
    update.customer_id = d || null
    // Reset the poll cursor when the account changes so we don't skip its leads.
    update.lsa_last_lead_time = null
  }
  if (typeof body.lsa_enabled === 'boolean') update.lsa_enabled = body.lsa_enabled

  const { error } = await admin
    .from('google_connections')
    .update(update)
    .eq('company_id', check.company_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
