import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runJobberQuoteBackfill } from '@/lib/jobber-sync'

/**
 * Populate the quote mirror from scratch — a FULL pull that ignores `updatedAt`.
 *
 * ⚠⚠ WHY THIS EXISTS AND THE NIGHTLY CANNOT REPLACE IT. The delta filters on
 * "updated since the last completed sync", so on the day quotes were added to the
 * mirror it fetches only quotes touched after that moment. Every quote sent before
 * then would never arrive, and the Sales report would draw a confident, thin,
 * recent-only picture — the same way `jobber_users` sat two months stale and made
 * every technician hired after June invisible. Missing history looks exactly like no
 * history, which is why this is an explicit step rather than something the nightly is
 * trusted to catch up on.
 *
 * Run once per company after Jobber is reconnected with `read_quotes`. Also the right
 * tool for a new subscriber, and for re-reading the book if quotes ever drift.
 *
 * Runs INLINE (not via after()) so the caller sees the count and can tell whether it
 * actually did anything — a backfill that silently returned zero is the failure mode
 * worth designing against. Bounded by the company's history floor and paged; quote
 * volume is a fraction of visits or invoices.
 *
 * ⚠ Before the company reconnects Jobber this returns a 409 naming the reconnect,
 * not a 500 and not a cheerful zero: "no quotes" and "no permission to read quotes"
 * must never look the same from the outside.
 */
async function resolveTarget(req: NextRequest): Promise<string | null> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
    return process.env.JOBBER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
  }

  // Otherwise an admin, backfilling THEIR OWN company — the company is read from the
  // caller's profile and never from the request, so this cannot be aimed elsewhere.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return null
  return profile.company_id ?? null
}

export async function POST(req: NextRequest) {
  const companyId = await resolveTarget(req)
  if (!companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await runJobberQuoteBackfill(companyId)

  if (result.error) {
    const needsReconnect = result.error.includes('read_quotes')
    return NextResponse.json(
      { companyId, ...result, ...(needsReconnect ? { action: 'Reconnect Jobber in Admin → Integrations' } : {}) },
      { status: needsReconnect ? 409 : 500 },
    )
  }

  return NextResponse.json({ companyId, ...result })
}
