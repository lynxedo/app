import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { getFleetDevices } from '@/lib/onestepgps'

// GET — live fleet devices + their standing driver, plus the pickable user list.
export async function GET() {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()

  let devices: { id: string; name: string }[] = []
  try {
    devices = (await getFleetDevices()).map((d) => ({ id: d.id, name: d.name }))
  } catch (e) {
    console.error('[vehicle-assignments] device fetch failed:', e)
  }

  const [{ data: assigns }, { data: users }] = await Promise.all([
    admin
      .from('hub_vehicle_assignments')
      .select('device_id, user_id')
      .eq('company_id', auth.company_id)
      .is('effective_date', null),
    admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', auth.company_id)
      .order('display_name', { ascending: true }),
  ])

  const assignMap = new Map<string, string>()
  for (const a of (assigns ?? []) as { device_id: string; user_id: string | null }[]) {
    if (a.user_id) assignMap.set(a.device_id, a.user_id)
  }

  return NextResponse.json({
    devices: devices.map((d) => ({ ...d, assigned_user_id: assignMap.get(d.id) ?? null })),
    users: users ?? [],
  })
}

// POST — set (or clear) a vehicle's standing driver. { device_id, device_name, user_id|null }
export async function POST(request: Request) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json()
  const deviceId: string = (body.device_id ?? '').trim()
  const deviceName: string | null = body.device_name ?? null
  const userId: string | null = body.user_id ?? null
  if (!deviceId) return NextResponse.json({ error: 'device_id required' }, { status: 400 })

  const admin = createAdminClient()

  // Standing default lives in a partial-unique index (effective_date IS NULL), which
  // Supabase upsert can't target by name — so replace it: delete the existing standing
  // row, then insert (or, when clearing, just delete).
  const { error: delErr } = await admin
    .from('hub_vehicle_assignments')
    .delete()
    .eq('company_id', auth.company_id)
    .eq('device_id', deviceId)
    .is('effective_date', null)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (!userId) return NextResponse.json({ ok: true, cleared: true })

  const { error: insErr } = await admin.from('hub_vehicle_assignments').insert({
    company_id: auth.company_id,
    device_id: deviceId,
    device_name: deviceName,
    user_id: userId,
    effective_date: null,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
