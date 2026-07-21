import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { nylasConfigured } from '@/lib/inbox/config'
import { syncCompany, backfillCompany } from '@/lib/inbox/sync'

export const dynamic = 'force-dynamic'
// The provider round-trips (folders + a page of threads/messages per mailbox, per
// company) can run long on a full sweep — give the sync route the cron budget.
export const maxDuration = 300

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? Math.floor(raw) : parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

// POST /api/hub/email/sync — two entry modes:
//   (a) cron:        header `x-cron-secret` === CRON_SECRET → sync a specific
//                    company ({companyId} in the body) or every company with
//                    connected mailboxes.
//   (b) interactive: an Integrations admin syncs their own company.
// Either way the actual work runs service-role (admin client) via syncCompany.
//
// Body options (both modes):
//   { backfill: true, days?: number (default 90), maxPages?: number (default 10) }
//   → instead of the newest-page poll, pages through up to maxPages pages of 50
//     threads whose latest message is within the last `days` days, so older mail
//     (in folders) mirrors too. Returns { pages, threads, messages } counts.
//
// Wire the cron on the prod VPS crontab, like the email/drip drainers:
//   curl -s -X POST https://lynxedo.com/api/hub/email/sync -H "x-cron-secret: $CRON_SECRET"
// One-off backfill:
//   curl -s -X POST https://lynxedo.com/api/hub/email/sync \
//     -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" \
//     -d '{"backfill":true,"days":90,"maxPages":10}'
export async function POST(request: NextRequest) {
  const admin = createAdminClient()
  const cronSecret = request.headers.get('x-cron-secret')

  // Parse the body ONCE up front (request.json() is single-shot) — both modes use it.
  const body = (await request.json().catch(() => null)) as {
    companyId?: string
    backfill?: boolean
    days?: number
    maxPages?: number
  } | null
  const backfill = body?.backfill === true
  const backfillOpts = {
    days: clampInt(body?.days, 90, 1, 3650),
    maxPages: clampInt(body?.maxPages, 10, 1, 50),
  }

  const runCompany = (companyId: string) =>
    backfill ? backfillCompany(admin, companyId, backfillOpts) : syncCompany(admin, companyId)

  // (a) Cron mode — trusted secret.
  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    if (!nylasConfigured()) {
      return NextResponse.json({ ok: true, held: true, message: 'nylas_not_configured' })
    }
    if (body?.companyId) {
      const result = await runCompany(body.companyId)
      return NextResponse.json({ ok: true, backfill, result })
    }
    // Sweep every company that has connected mailboxes.
    const { data } = await admin.from('inbox_accounts').select('company_id').eq('active', true)
    const companyIds = Array.from(new Set((data ?? []).map((r) => r.company_id as string)))
    const results: Array<Record<string, unknown>> = []
    for (const cid of companyIds) {
      results.push({ companyId: cid, ...(await runCompany(cid)) })
    }
    return NextResponse.json({ ok: true, backfill, companies: companyIds.length, results })
  }

  // (b) Interactive mode — an Integrations admin syncs their own company.
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!nylasConfigured()) {
    return NextResponse.json({ ok: true, held: true, message: 'nylas_not_configured' })
  }
  const result = await runCompany(check.company_id)
  return NextResponse.json({ ok: true, backfill, result })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'hub/email/sync',
    nylas_configured: nylasConfigured(),
  })
}
