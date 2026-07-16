import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { disconnectGoogle } from '@/lib/google-oauth'

export const dynamic = 'force-dynamic'

// POST /api/auth/google/disconnect — revoke + forget this company's Google
// connection. Anything that needs Google (the LSA poller, Ads data) stops until
// the admin reconnects.
export async function POST() {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  await disconnectGoogle(createAdminClient(), check.company_id)
  return NextResponse.json({ ok: true })
}
