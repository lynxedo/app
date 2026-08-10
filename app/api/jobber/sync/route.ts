import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runInitialJobberSync, runDeltaJobberSync } from '@/lib/jobber-sync'
import { checkCustomerLinkHealth } from '@/lib/jobber-customer-link'

// Fallback company for a cron call that names none — keeps the existing nightly
// delta cron working untouched. ⚠ It is a FALLBACK, not a pin: a signed-in admin
// now always syncs their OWN company (see below), so a second tenant is no longer
// locked out of triggering a sync the way the old env-pinned version locked them out.
const FALLBACK_COMPANY_ID = process.env.JOBBER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

/**
 * Resolve WHICH company this sync is for, alongside whether the caller may run it.
 *
 * Previously the company came from an env var, so only one tenant could ever be
 * synced — a hard blocker for onboarding a second subscriber. A signed-in admin now
 * syncs their own company, taken from their profile and never from the request, so
 * this route can't be aimed at another tenant. Cron keeps the env fallback so the
 * existing nightly delta cron is untouched.
 */
async function resolveSyncTarget(req: NextRequest): Promise<string | null> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) return FALLBACK_COMPANY_ID
    if (req.headers.get('Authorization') === `Bearer ${cronSecret}`) return FALLBACK_COMPANY_ID
  }

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
  const companyId = await resolveSyncTarget(req)
  if (!companyId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const type = body.type === 'delta' ? 'delta' : 'initial'

  // Kick off post-response via after() — still not awaited before the response
  // (initial pull takes 10–20 min), but guaranteed to run to completion, unlike
  // a bare detached promise.
  //
  // ⚠ For a NEW subscriber prefer POST /api/jobber/backfill, not this route: the
  // initial pull here has to finish inside one process, so a multi-hour first pull
  // dies with any timeout or deploy and starts over. The backfill route persists a
  // cursor after every page and resumes.
  if (type === 'initial') {
    after(() => runInitialJobberSync(companyId).catch(err =>
      console.error('[jobber-sync] Unhandled error in initial sync:', err)
    ))
  } else {
    after(() => runDeltaJobberSync(companyId).catch(err =>
      console.error('[jobber-sync] Unhandled error in delta sync:', err)
    ))
  }

  // Watch the customer-link sweep from here, because a job cannot report its own
  // death: if that cron stops firing, nothing inside it runs. This is a different
  // cron line, so it notices and DMs the admins. No-ops when the feature isn't set
  // up, when nothing is queued, or when the sweep ran recently.
  after(() => checkCustomerLinkHealth(companyId).catch(err =>
    console.error('[jobber-sync] customer-link health check failed:', err)
  ))

  return NextResponse.json({ status: 'started', type, companyId })
}
