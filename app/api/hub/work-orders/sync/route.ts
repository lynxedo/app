import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompany } from '@/lib/company-auth'
import { workOrderAccess } from '@/lib/work-order-access'
import {
  syncWorkOrdersForRange, todayInCompanyTz, addDays, WORK_ORDER_HORIZON_DAYS, type SyncDayResult,
} from '@/lib/work-orders-sync'
import { refreshJobsByExternalIds } from '@/lib/jobber-sync'

// POST /api/hub/work-orders/sync — Work Orders Phase 1.5 (PRD §6).
//
// Two callers:
//  • The VPS cron, every 10 minutes, with `x-cron-secret`: sweeps today + 7 days
//    for every company that has a Jobber connection. The webhooks keep the list
//    in step within seconds where this code is deployed; the sweep is the safety
//    net (and, on staging, the only trigger until the hooks reach prod).
//  • A Work Orders admin (workOrderAccess().isAdmin) from the Work Orders header:
//    body { date?: 'YYYY-MM-DD', days?: number } — defaults to today, 1 day.
//    body { refreshJobs: true } additionally re-pulls the Jobber jobs behind the
//    horizon's visits whose `instructions` are still unmirrored (post-response).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type Body = { date?: unknown; days?: unknown; refreshJobs?: unknown }

async function companiesWithJobber(): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin.from('jobber_tokens').select('company_id')
  return [...new Set((data ?? []).map(r => r.company_id as string).filter(Boolean))]
}

/** Jobs behind the horizon's visits that have no mirrored instructions yet. */
async function jobsNeedingInstructions(companyId: string, fromDate: string, days: number): Promise<string[]> {
  const admin = createAdminClient()
  const { data: visits } = await admin
    .from('visits').select('job_external_id')
    .eq('company_id', companyId).is('deleted_at', null)
    .gte('scheduled_date', fromDate).lte('scheduled_date', addDays(fromDate, days - 1))
  const jobIds = [...new Set((visits ?? []).map(v => v.job_external_id as string | null).filter((x): x is string => !!x))]
  if (jobIds.length === 0) return []
  const need: string[] = []
  for (let i = 0; i < jobIds.length; i += 150) {
    const slice = jobIds.slice(i, i + 150)
    const { data: jobs } = await admin
      .from('jobs').select('external_id, instructions')
      .eq('company_id', companyId).in('external_id', slice)
    for (const j of jobs ?? []) if (j.instructions == null) need.push(j.external_id as string)
  }
  return need
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const isCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret

  let body: Body = {}
  try { body = (await req.json()) as Body } catch { /* no body */ }

  if (isCron) {
    const today = todayInCompanyTz()
    const out: Record<string, SyncDayResult[]> = {}
    for (const companyId of await companiesWithJobber()) {
      // One-off operator action (`-d '{"refreshJobs":true}'` with the secret):
      // backfill `jobs.instructions` for the horizon before sweeping.
      if (body.refreshJobs === true) {
        const need = await jobsNeedingInstructions(companyId, today, WORK_ORDER_HORIZON_DAYS)
        if (need.length > 0) {
          const n = await refreshJobsByExternalIds(companyId, need).catch(e => {
            console.error('[work-orders] job refresh failed:', e instanceof Error ? e.message : String(e)); return 0
          })
          console.log(`[work-orders] refreshed ${n}/${need.length} jobs for instructions (${companyId})`)
        }
      }
      out[companyId] = await syncWorkOrdersForRange(companyId, today, WORK_ORDER_HORIZON_DAYS)
    }
    const totals = Object.values(out).flat().reduce(
      (a, r) => ({ visits: a.visits + r.visits, inserted: a.inserted + r.inserted, moved: a.moved + r.moved, deleted: a.deleted + r.deleted, flagged: a.flagged + r.flagged }),
      { visits: 0, inserted: 0, moved: 0, deleted: 0, flagged: 0 },
    )
    console.log('[work-orders] sweep', JSON.stringify(totals))
    return NextResponse.json({ ok: true, companies: Object.keys(out).length, totals, results: out })
  }

  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, userId, role, supabase } = auth
  let allowed = role === 'admin'
  if (!allowed) {
    const { data: profile } = await supabase.from('user_profiles').select('role, can_admin_daily_log, can_access_daily_log_v2').eq('id', userId).single()
    allowed = workOrderAccess(profile).isAdmin
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const date = typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : todayInCompanyTz()
  const days = typeof body.days === 'number' && Number.isFinite(body.days) ? Math.max(1, Math.min(14, Math.floor(body.days))) : 1

  let refreshQueued = 0
  if (body.refreshJobs === true) {
    const need = await jobsNeedingInstructions(companyId, date, Math.max(days, WORK_ORDER_HORIZON_DAYS))
    refreshQueued = need.length
    if (need.length > 0) {
      // Post-response, and guaranteed to run (lesson: a detached void() may not).
      after(() =>
        refreshJobsByExternalIds(companyId, need)
          .then(n => console.log(`[work-orders] refreshed ${n} jobs for instructions`))
          .catch(e => console.error('[work-orders] job refresh failed:', e instanceof Error ? e.message : String(e))),
      )
    }
  }

  const results = await syncWorkOrdersForRange(companyId, date, days)
  return NextResponse.json({ ok: true, results, refreshQueued })
}
