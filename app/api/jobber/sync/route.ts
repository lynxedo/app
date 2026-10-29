import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runInitialJobberSync, runDeltaJobberSync } from '@/lib/jobber-sync'
import { checkCustomerLinkHealth } from '@/lib/jobber-customer-link'

// A cron call syncs EVERY company with a Jobber connection (one after another);
// a signed-in admin syncs only their own (see below).
const ALL_CONNECTED = 'all-connected'

/**
 * Resolve WHICH company this sync is for, alongside whether the caller may run it.
 *
 * Previously the company came from an env var, so only one tenant could ever be
 * synced — a hard blocker for onboarding a second subscriber. A signed-in admin now
 * syncs their own company, taken from their profile and never from the request, so
 * this route can't be aimed at another tenant. Cron syncs every connected company.
 */
async function resolveSyncTarget(req: NextRequest): Promise<string | null> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) return ALL_CONNECTED
    if (req.headers.get('Authorization') === `Bearer ${cronSecret}`) return ALL_CONNECTED
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
  if (companyId === ALL_CONNECTED) {
    // Cron: a delta for every company with a Jobber connection, one after another
    // (never in parallel — Jobber throttles per app). A first pull is never
    // started this way; it goes through POST /api/jobber/backfill per company.
    if (type === 'initial') {
      return NextResponse.json({ error: 'Name a company for an initial sync' }, { status: 400 })
    }
    const { data: tokens } = await createAdminClient().from('jobber_tokens').select('company_id')
    const companyIds = [...new Set((tokens ?? []).map(t => t.company_id as string).filter(Boolean))]
    after(async () => {
      for (const id of companyIds) {
        await runDeltaJobberSync(id).catch(err =>
          console.error('[jobber-sync] Unhandled error in delta sync for', id, err)
        )
        await checkCustomerLinkHealth(id).catch(err =>
          console.error('[jobber-sync] customer-link health check failed for', id, err)
        )
      }
    })
    return NextResponse.json({ status: 'started', type, companyIds })
  }

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
