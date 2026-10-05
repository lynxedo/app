import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { runMorningSummary } from '@/lib/amber-run'

// "Run it now" — a test run of the morning summary, DMed to the admin who
// pressed it (never posted in the team room). Anything Amber proposes still goes
// into the real approval queue. Recorded in amber_runs as 'morning_test', which
// never counts as today's scheduled run.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const res = await runMorningSummary(createAdminClient(), auth.company_id, {
    kind: 'morning_test',
    testRecipientId: auth.user.id,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 })
  return NextResponse.json({ costUsd: res.costUsd, queued: res.queued })
}
