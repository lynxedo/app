import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { companiesDueForMorning, runMorningSummary } from '@/lib/amber-run'

// Amber's scheduled runs — called by the VPS cron every 5 minutes:
//   */5 * * * * curl -s -X POST https://lynxedo.com/api/amber/run/tick -H "x-cron-secret: $CRON_SECRET"
//
// A tick only starts what is due (company's time reached, a chosen weekday, not
// more than 2 hours late). The amber_runs once-a-day row is the real guard, so
// overlapping ticks — or staging and prod both ticking against the shared DB —
// can't post twice. The work runs in after(): the cron call returns at once,
// and a detached promise would be dropped (lesson_nextjs_after_for_post_response_work).

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  const due = await companiesDueForMorning(admin)
  if (due.length) {
    after(async () => {
      for (const companyId of due) {
        const res = await runMorningSummary(admin, companyId, { kind: 'morning' })
        if (!res.ok && res.error !== 'Already ran today.') {
          console.warn('[amber-run] morning summary', companyId, res.error)
        }
      }
    })
  }
  return NextResponse.json({ ok: true, due: due.length })
}
