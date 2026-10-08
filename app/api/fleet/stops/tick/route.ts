import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runFleetVisitTick } from '@/lib/fleet-visit-tick'

export const dynamic = 'force-dynamic'

// Every-minute cron (prod only, like the fleet alert check): GPS backup for
// arrived / left on today's Work Order stops, then the custom arrival alerts.
//
// OneStepGPS is one global account owned by one company (see
// app/api/fleet/alerts/check) — only that company's trucks are evaluated.
const FLEET_GPS_COMPANY_ID =
  process.env.FLEET_GPS_COMPANY_ID ?? '00000000-0000-0000-0000-000000000002'

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runFleetVisitTick(createAdminClient(), FLEET_GPS_COMPANY_ID)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[fleet-stops-tick]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
