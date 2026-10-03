import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sweepVanishedVisits } from '@/lib/jobber-sync'

// POST /api/jobber/visits/sweep — the nightly ghost-visit sweep (cron secret only).
//
// Asks Jobber, by id, whether every uncompleted visit in the mirror still exists,
// for every company with a Jobber connection, and tombstones (soft) the ones it
// dropped. Guards live in reconcileDeletedVisits (lib/jobber-sync.ts): a failed or
// empty probe never deletes, a deletion needs a second corroborating signal, and
// one run is capped.
//
// Why it exists (Oct 2 2026): a reschedule of a recurring job makes Jobber delete
// the old visits and create new ones. The JOB_UPDATE re-check only looks six months
// ahead and only fires for edits made after it shipped, and the old repair pass was
// never scheduled — Ben found ten leftover LHC visits on a job he had fixed days
// earlier, and ~80 live jobs carried the same residue. Reports and Amber read the
// mirror, so a ghost there is a wrong answer. (Work Orders checks each day against
// Jobber live and was never affected.)
//
// Body (optional): { horizonDays?: number | 'all', maxTombstones?: number, dryRun?: boolean }
// dryRun: probe and corroborate exactly as a real run, report `wouldTombstone`, write nothing.
// Default: every date, the standard per-run cap. Runs INLINE so the caller gets the
// counts; the VPS cron calls it on localhost to stay clear of Cloudflare's 100 s cut-off.

export const maxDuration = 900

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { horizonDays?: unknown; maxTombstones?: unknown; dryRun?: unknown } = {}
  try { body = await req.json() } catch { /* no body */ }
  const horizonDays = typeof body.horizonDays === 'number' && body.horizonDays > 0 ? Math.floor(body.horizonDays) : null
  const maxTombstones = typeof body.maxTombstones === 'number' && body.maxTombstones > 0
    ? Math.min(Math.floor(body.maxTombstones), 2000)
    : undefined
  const dryRun = body.dryRun === true

  const admin = createAdminClient()
  const { data } = await admin.from('jobber_tokens').select('company_id')
  const companies = [...new Set((data ?? []).map(r => r.company_id as string).filter(Boolean))]

  const started = Date.now()
  const results: Record<string, Awaited<ReturnType<typeof sweepVanishedVisits>>> = {}
  for (const companyId of companies) {
    results[companyId] = await sweepVanishedVisits(companyId, { horizonDays, maxTombstones, dryRun })
  }
  const failed = Object.values(results).some(r => r.error)
  const summary = { ok: !failed, dryRun, companies: companies.length, seconds: Math.round((Date.now() - started) / 1000), results }
  console.log('[jobber-visit-sweep]', JSON.stringify(summary))
  return NextResponse.json(summary, { status: failed ? 207 : 200 })
}
