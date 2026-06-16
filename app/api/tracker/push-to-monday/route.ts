import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runMondayPush } from '@/lib/monday-push'
import { fanoutGuardianNotification } from '@/lib/guardian-post'

const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'

type PushAdmin = ReturnType<typeof createAdminClient>
async function alertPushFailure(admin: PushAdmin, errors: string[], context: string) {
  try {
    const { data: admins } = await admin
      .from('user_profiles').select('id')
      .eq('company_id', HEROES_COMPANY_ID).eq('role', 'admin')
    const ids = (admins ?? []).map((a: { id: string }) => a.id)
    if (!ids.length) return
    await fanoutGuardianNotification({
      companyId: HEROES_COMPANY_ID,
      userIds: ids,
      roomIds: [],
      body: `⚠️ Tracker Monday PUSH ${context}:\n${errors.slice(0, 10).map(e => `• ${e}`).join('\n')}`,
      admin,
    })
  } catch (e) {
    console.error('[monday-push] failure alert failed', e)
  }
}

// One-way Lynxedo -> Monday push for the Lead Tracker board.
//   POST                 -> push all changed leads (create / update / archive)
//   POST ?dryRun=1       -> report what WOULD be pushed, write NOTHING
//   POST ?leadId=<uuid>  -> push (or dry-run) a single lead, no archive pass
// Auth: x-cron-secret header (nightly VPS cron) OR an admin session.

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) return true
    if (req.headers.get('Authorization') === `Bearer ${cronSecret}`) return true
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin'
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Same kill-switch convention as the pull: TRACKER_SYNC_MODE=native disables
  // the Monday bridge entirely (post-cutover) without a code deploy.
  if (process.env.TRACKER_SYNC_MODE === 'native') {
    return NextResponse.json({ skipped: true, reason: 'TRACKER_SYNC_MODE=native — Monday push disabled' })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === '1'
  const leadId = url.searchParams.get('leadId') || undefined

  const admin = createAdminClient()
  try {
    const report = await runMondayPush(admin, { dryRun, leadId })
    if (!dryRun && report.errors.length) {
      await alertPushFailure(admin, report.errors, 'had errors')
    }
    return NextResponse.json(report)
  } catch (e: any) {
    console.error('[monday-push] fatal:', e)
    if (!dryRun) await alertPushFailure(admin, [e?.message ?? String(e)], 'failed completely')
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
