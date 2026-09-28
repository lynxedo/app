import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Cron-driven status log. Wire on the VPS (ONE environment only — staging and
// prod share the database; a second caller is harmless but pointless):
//   * * * * * curl -s -X POST https://lynxedo.com/api/hub/status-log/tick \
//     -H "x-cron-secret: $CRON_SECRET"
//
// hub_status_sample() reads every person's current dot colour and opens a new
// hub_status_intervals row for anyone whose colour changed since the last tick.
// The colour is derived (clock-in, 2h activity), so it has to be sampled —
// nothing writes to the database when an hourly person's dot goes grey.
export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('hub_status_sample')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ changed: data ?? 0 })
}
