import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDeviceHistory } from '@/lib/onestepgps'
import { tzOffset } from '@/lib/tz'

export const dynamic = 'force-dynamic'

// Heroes' operating timezone. Same DST-aware day-bounds approach as
// /api/visits (test-findings #8): build the UTC range for a local calendar
// day using the day's real offset instead of a bare datetime.
const FLEET_TZ = 'America/Chicago'

function localDayBounds(date: string, timeZone = FLEET_TZ): { start: string; end: string } {
  const offset = tzOffset(date, timeZone)
  return {
    start: new Date(`${date}T00:00:00${offset}`).toISOString(),
    end: new Date(`${date}T23:59:59${offset}`).toISOString(),
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_fleet, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_fleet) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const deviceId = searchParams.get('device_id') ?? ''
  const date = searchParams.get('date') ?? ''
  if (!deviceId || deviceId.length > 100) {
    return NextResponse.json({ error: 'device_id is required' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const { start, end } = localDayBounds(date)
  try {
    const history = await getDeviceHistory(deviceId, start, end, profile.company_id ?? undefined)
    return NextResponse.json(history)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
