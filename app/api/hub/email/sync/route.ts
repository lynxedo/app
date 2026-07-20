import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { nylasConfigured } from '@/lib/inbox/config'
import { syncCompany } from '@/lib/inbox/sync'

export const dynamic = 'force-dynamic'
// The provider round-trips (folders + a page of threads/messages per mailbox, per
// company) can run long on a full sweep — give the sync route the cron budget.
export const maxDuration = 300

// POST /api/hub/email/sync — two entry modes:
//   (a) cron:        header `x-cron-secret` === CRON_SECRET → sync a specific
//                    company ({companyId} in the body) or every company with
//                    connected mailboxes.
//   (b) interactive: an Integrations admin syncs their own company.
// Either way the actual work runs service-role (admin client) via syncCompany.
//
// Wire the cron on the prod VPS crontab, like the email/drip drainers:
//   curl -s -X POST https://lynxedo.com/api/hub/email/sync -H "x-cron-secret: $CRON_SECRET"
export async function POST(request: NextRequest) {
  const admin = createAdminClient()
  const cronSecret = request.headers.get('x-cron-secret')

  // (a) Cron mode — trusted secret.
  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    if (!nylasConfigured()) {
      return NextResponse.json({ ok: true, held: true, message: 'nylas_not_configured' })
    }
    const body = (await request.json().catch(() => null)) as { companyId?: string } | null
    if (body?.companyId) {
      const result = await syncCompany(admin, body.companyId)
      return NextResponse.json({ ok: true, result })
    }
    // Sweep every company that has connected mailboxes.
    const { data } = await admin.from('inbox_accounts').select('company_id').eq('active', true)
    const companyIds = Array.from(new Set((data ?? []).map((r) => r.company_id as string)))
    const results: Array<{ companyId: string; accounts: number; threads: number; messages: number; errors: string[] }> = []
    for (const cid of companyIds) {
      results.push({ companyId: cid, ...(await syncCompany(admin, cid)) })
    }
    return NextResponse.json({ ok: true, companies: companyIds.length, results })
  }

  // (b) Interactive mode — an Integrations admin syncs their own company.
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!nylasConfigured()) {
    return NextResponse.json({ ok: true, held: true, message: 'nylas_not_configured' })
  }
  const result = await syncCompany(admin, check.company_id)
  return NextResponse.json({ ok: true, result })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'hub/email/sync',
    nylas_configured: nylasConfigured(),
  })
}
