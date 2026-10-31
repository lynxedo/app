import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { HEROES_COMPANY_ID } from '@/lib/jobber-apps'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/jobber/purge — nightly. Deletes the copied Jobber data of every
 * company whose 30-day window after a disconnect has run out
 * (Servanto Starter Session 2, lib/jobber-disconnect.ts).
 *
 * Cron (VPS crontab, prod only — staging shares the DB):
 *   15 4 * * * curl -s -X POST https://lynxedo.com/api/jobber/purge -H "x-cron-secret: $CRON_SECRET"
 *
 * ⚠ DRY RUN unless JOBBER_PURGE_LIVE=1 is set in the server's env: it only counts
 * what it would delete and logs it, leaving the record pending. Deletion is
 * irreversible, so it stays off until Ben has seen a dry run and said yes.
 *
 * Guards, each independent: the record must have a purge date (Heroes and
 * Lynxedo-app companies never get one); Heroes is skipped here by id; and the SQL
 * function refuses Heroes and any company that has reconnected.
 */
export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const live = process.env.JOBBER_PURGE_LIVE === '1'
  const admin = createAdminClient()

  const { data: due, error } = await admin
    .from('jobber_disconnects')
    .select('id, company_id, purge_after')
    .lte('purge_after', new Date().toISOString())
    .is('purged_at', null)
    .is('purge_cancelled_at', null)
    .not('purge_after', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A company can have several open records (a disconnect clicked twice, a
  // redelivered webhook). Purge each company once, then close all its records.
  const byCompany = new Map<string, string[]>()
  for (const r of due ?? []) {
    if (r.company_id === HEROES_COMPANY_ID) continue
    byCompany.set(r.company_id, [...(byCompany.get(r.company_id) ?? []), r.id])
  }

  const results: Record<string, unknown> = {}
  for (const [companyId, ids] of byCompany) {
    const { data: summary, error: rpcErr } = await admin.rpc('purge_company_jobber_data', {
      p_company_id: companyId,
      p_dry_run: !live,
    })
    if (rpcErr) {
      console.error(`[jobber-purge] ${companyId} failed:`, rpcErr.message)
      results[companyId] = { error: rpcErr.message }
      continue
    }
    console.log(`[jobber-purge] ${live ? 'PURGED' : 'dry run'} ${companyId}:`, JSON.stringify(summary))
    results[companyId] = summary
    if (live) {
      await admin
        .from('jobber_disconnects')
        .update({ purged_at: new Date().toISOString(), purge_summary: summary })
        .in('id', ids)
    }
  }

  return NextResponse.json({ ok: true, live, companies: byCompany.size, results })
}
