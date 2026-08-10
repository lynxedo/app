import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  advanceAllJobberBackfills,
  advanceJobberBackfill,
  getJobberBackfillProgress,
  startJobberBackfill,
} from '@/lib/jobber-backfill'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// A slice is time-budgeted below the platform ceiling, but give the request room
// to finish and persist rather than being killed mid-page.
export const maxDuration = 300

type Caller =
  | { kind: 'cron' }
  | { kind: 'admin'; companyId: string }
  | { kind: 'none' }

/**
 * Cron may advance any company. A human may only ever act on their OWN company —
 * the company is taken from their profile and never from the request body, so this
 * route cannot be used to start a pull against someone else's tenant.
 */
async function resolveCaller(req: NextRequest): Promise<Caller> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) return { kind: 'cron' }
    if (req.headers.get('Authorization') === `Bearer ${cronSecret}`) return { kind: 'cron' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { kind: 'none' }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role, company_id, can_admin_integrations')
    .eq('id', user.id)
    .single()

  const allowed = profile?.role === 'admin' || profile?.can_admin_integrations === true
  if (!allowed || !profile?.company_id) return { kind: 'none' }
  return { kind: 'admin', companyId: profile.company_id }
}

/**
 * POST — start, or advance, a backfill.
 *
 *   { "action": "start", "startDate": "2019-04-01" }  begin (or restart) a backfill
 *   { "action": "advance" }                            work one time-bounded slice
 *
 * Cron with no body advances every unfinished company; that is the loop that
 * carries a multi-hour pull to completion.
 */
export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (caller.kind === 'none') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'start' | 'advance'
    startDate?: string
    budgetMs?: number
  }
  const budgetMs = Number.isFinite(body.budgetMs)
    ? Math.min(Math.max(Number(body.budgetMs), 10_000), 280_000)
    : undefined

  // Cron, no explicit action: sweep every company that still has work.
  if (caller.kind === 'cron' && !body.action) {
    const results = await advanceAllJobberBackfills(budgetMs)
    return NextResponse.json({ ok: true, advanced: results })
  }

  if (caller.kind === 'cron') {
    return NextResponse.json(
      { error: 'cron may only sweep; omit "action" to advance all companies' },
      { status: 400 },
    )
  }

  if (body.action === 'start') {
    if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
      return NextResponse.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 400 })
    }
    const progress = await startJobberBackfill(caller.companyId, body.startDate)
    return NextResponse.json({ ok: true, started: true, progress })
  }

  const progress = await advanceJobberBackfill(caller.companyId, budgetMs)
  return NextResponse.json({ ok: true, progress })
}

/** GET — progress for the caller's own company (or a named one, for cron). */
export async function GET(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (caller.kind === 'none') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (caller.kind === 'cron') {
    const companyId = new URL(req.url).searchParams.get('companyId')
    if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })
    return NextResponse.json({ ok: true, progress: await getJobberBackfillProgress(companyId) })
  }

  return NextResponse.json({
    ok: true,
    progress: await getJobberBackfillProgress(caller.companyId),
  })
}
