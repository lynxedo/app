import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncSoldLeadsToRecurring } from '@/lib/recurring-sync'

// Replicates the Monday "1 day after Sold Date -> duplicate to Recurring
// Services" automation. Auth: x-cron-secret (for the daily cron) OR a logged-in
// admin (manual run). Pass ?dryRun=1 to preview without inserting.
//
// Wire on the VPS (when enabling):
//   0 9 * * * curl -s -X POST https://staging.lynxedo.com/api/tracker/recurring/sync-from-leads \
//     -H "x-cron-secret: $CRON_SECRET"
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === '1' || searchParams.get('dryRun') === 'true'

  const secret = request.headers.get('x-cron-secret')
  const cronOk = !!secret && secret === process.env.CRON_SECRET

  if (!cronOk) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const admin = createAdminClient()
    const result = await syncSoldLeadsToRecurring(admin, { dryRun })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'sync failed' }, { status: 500 })
  }
}
