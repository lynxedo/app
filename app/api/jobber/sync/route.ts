import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runInitialJobberSync, runDeltaJobberSync, backfillVisitLineItems, backfillVisitInvoiceIds } from '@/lib/jobber-sync'

const COMPANY_ID = '00000000-0000-0000-0000-000000000002'

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // Cron secret auth (nightly delta cron, Session 68). Accept both the
  // x-cron-secret header used by every other cron on the VPS and the legacy
  // Authorization: Bearer form.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) return true
    if (req.headers.get('Authorization') === `Bearer ${cronSecret}`) return true
  }

  // Admin session auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'admin'
}

export async function POST(req: NextRequest) {
  if (!await isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const type = body.type === 'delta' ? 'delta'
    : body.type === 'backfill-visit-lines' ? 'backfill-visit-lines'
    : body.type === 'backfill-visit-invoices' ? 'backfill-visit-invoices'
    : 'initial'

  if (type === 'backfill-visit-lines') {
    const result = await backfillVisitLineItems(COMPANY_ID)
    return NextResponse.json({ status: 'complete', type, ...result })
  }
  if (type === 'backfill-visit-invoices') {
    // Fire in background — 1,200+ visits takes > Cloudflare's 100s timeout
    void backfillVisitInvoiceIds(COMPANY_ID).catch(err =>
      console.error('[jobber-sync] backfill-visit-invoices error:', err)
    )
    return NextResponse.json({ status: 'started', type })
  }

  // Kick off in background — don't await (initial pull takes 10–20 min)
  if (type === 'initial') {
    void runInitialJobberSync(COMPANY_ID).catch(err =>
      console.error('[jobber-sync] Unhandled error in initial sync:', err)
    )
  } else {
    void runDeltaJobberSync(COMPANY_ID).catch(err =>
      console.error('[jobber-sync] Unhandled error in delta sync:', err)
    )
  }

  return NextResponse.json({ status: 'started', type })
}
