import { NextResponse } from 'next/server'
import { reconcileDeletedJobs } from '@/lib/jobber-reconcile'

// Finds mirror jobs that no longer exist in Jobber and tombstones them.
//
// Reports only by default. Pass ?apply=1 to write — deciding that live rows are
// dead, based on an external API's answer, should never be the accidental path.
//
//   curl -X POST ".../api/jobber/reconcile?companyId=<id>"          # dry run
//   curl -X POST ".../api/jobber/reconcile?companyId=<id>&apply=1"  # write

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const companyId = url.searchParams.get('companyId')
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })

  const apply = url.searchParams.get('apply') === '1'
  const result = await reconcileDeletedJobs(companyId, { apply })
  return NextResponse.json({ ok: true, apply, ...result })
}
