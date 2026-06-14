import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runMondaySync, type BoardKey } from '@/lib/monday-sync'
import { fanoutGuardianNotification } from '@/lib/guardian-post'

const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'

// TR5: surface sync failures (the nightly cron's errors were otherwise invisible).
type SyncAdmin = ReturnType<typeof createAdminClient>
async function alertSyncFailure(admin: SyncAdmin, errors: string[], context: string) {
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
      body: `⚠️ Tracker Monday sync ${context}:\n${errors.map(e => `• ${e}`).join('\n')}`,
      admin,
    })
  } catch (e) {
    console.error('[monday-sync] failure alert failed', e)
  }
}

// One-way Monday -> Lynxedo Tracker mirror.
//   POST            -> full sync (upsert + guarded hard-delete) of all 3 boards
//   POST ?dryRun=1  -> pull + compute the leads re-key match, write NOTHING
//   POST ?boards=recurring,route,leads  -> limit to specific boards
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
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return profile?.role === 'admin'
}

const VALID_BOARDS: BoardKey[] = ['recurring', 'route', 'leads']

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === '1'
  const boardsParam = url.searchParams.get('boards')
  const boards = boardsParam
    ? (boardsParam.split(',').map(s => s.trim()).filter(b => VALID_BOARDS.includes(b as BoardKey)) as BoardKey[])
    : undefined

  const admin = createAdminClient()
  try {
    const report = await runMondaySync(admin, { dryRun, boards })
    // Alert admins on a partial failure (a board errored). Skip dry runs — the caller
    // sees those in the response.
    if (!dryRun && report.errors.length) {
      await alertSyncFailure(admin, report.errors, 'had errors')
    }
    return NextResponse.json(report)
  } catch (e: any) {
    console.error('[monday-sync] fatal:', e)
    if (!dryRun) await alertSyncFailure(admin, [e?.message ?? String(e)], 'failed completely')
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
