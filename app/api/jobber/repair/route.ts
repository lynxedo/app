import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileJobberOpenRecords } from '@/lib/jobber-sync'

/**
 * Repair the Jobber mirror's OPEN records — invoices we still think are unpaid and
 * jobs we still think are live — by re-reading each one from Jobber by id.
 *
 * ⚠ NOT /api/jobber/reconcile. Prod already has a different tool at that path
 * (reconcileDeletedJobs — dry-run-by-default job tombstoning). `develop` deleted
 * it during the Reports work, so on this branch the name looks free; taking it
 * would silently replace a live prod safety tool with something else. Two tools,
 * two paths. That develop/main divergence is worth reconciling separately.
 *
 * Why this is a route and not a cron line: webhooks are the mechanism. What this
 * fixes is the residue — records that changed before the durable webhook queue
 * existed, a subscriber's first backfill, or whatever a dropped event leaves
 * behind. Measured 2026-08-11 on Heroes: 34 of 36 phantom invoice balances and 90
 * of 100 phantom "requires invoicing" jobs predated the queue.
 *
 * Runs INLINE (not via after()) so the caller gets the counts back and can see
 * whether the repair actually did anything. The work is bounded by how many
 * records we believe are open, so it is seconds, not minutes.
 */
async function resolveTarget(req: NextRequest): Promise<string | null> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) {
      return process.env.JOBBER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
    }
  }

  // Otherwise an admin, repairing THEIR OWN company — the company is read from the
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

  const result = await reconcileJobberOpenRecords(companyId)

  // Partial failure is reported as such rather than as success — a repair that
  // silently half-ran is worse than one that says so.
  return NextResponse.json(
    { companyId, ...result },
    { status: result.errors.length ? 207 : 200 },
  )
}
