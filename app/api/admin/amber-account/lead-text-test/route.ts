import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { LEAD_SOURCES, runLeadTextTest } from '@/lib/amber-lead-text'

// "Send me a test" under New leads: the first text the latest real Angi / Google
// lead would get with the current setting, DMed to the admin who pressed it.
// Nothing reaches a customer.

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: Request) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { source?: unknown } | null
  const source = body?.source
  if (!LEAD_SOURCES.includes(source as never)) return NextResponse.json({ error: 'Unknown lead source' }, { status: 400 })
  const res = await runLeadTextTest(createAdminClient(), auth.company_id, {
    source: source as (typeof LEAD_SOURCES)[number],
    recipientId: auth.user.id,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 })
  return NextResponse.json(res)
}
