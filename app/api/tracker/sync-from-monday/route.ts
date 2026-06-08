import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runMondaySync, type BoardKey } from '@/lib/monday-sync'

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

  try {
    const admin = createAdminClient()
    const report = await runMondaySync(admin, { dryRun, boards })
    return NextResponse.json(report)
  } catch (e: any) {
    console.error('[monday-sync] fatal:', e)
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
