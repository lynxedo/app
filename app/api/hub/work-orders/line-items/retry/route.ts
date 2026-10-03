import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { retryPendingStopCompletions } from '@/lib/work-order-line-items'

// POST /api/hub/work-orders/line-items/retry — VPS cron every 5 minutes with
// `x-cron-secret`. Finishes completed stops whose Jobber side is still waiting:
// line items that failed to land, then visitComplete (Work Orders Phase 2).
// Each stop is locked while it is pushed, so an overlapping run or a tech
// pressing Complete again never sends an item twice.

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  const { data } = await admin.from('jobber_tokens').select('company_id')
  const companies = [...new Set((data ?? []).map(r => r.company_id as string).filter(Boolean))]
  const out: Record<string, { tried: number; completed: number }> = {}
  for (const companyId of companies) {
    try {
      out[companyId] = await retryPendingStopCompletions(companyId)
    } catch (e) {
      console.error('[work-orders] line-item retry failed for', companyId, e)
    }
  }
  return NextResponse.json({ ok: true, companies: out })
}
