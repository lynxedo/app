import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { geocodeAddress } from '@/lib/geocode'

export async function GET() {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hub_geofences')
    .select('id, name, address, lat, lng, radius_m, created_at')
    .eq('company_id', auth.company_id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ geofences: data ?? [] })
}

export async function POST(request: Request) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id || !auth.user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json()
  const name: string = (body.name ?? '').trim()
  const address: string = (body.address ?? '').trim()
  let lat = typeof body.lat === 'number' ? body.lat : null
  let lng = typeof body.lng === 'number' ? body.lng : null
  const radiusM = Number.isFinite(body.radius_m) ? Math.round(body.radius_m) : 137

  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  // Geocode the address if no explicit coords were provided.
  if ((lat === null || lng === null) && address) {
    const geo = await geocodeAddress(address)
    if (!geo) {
      return NextResponse.json(
        { error: 'Could not find that address. Check the spelling or enter coordinates.' },
        { status: 422 },
      )
    }
    lat = geo.lat
    lng = geo.lng
  }
  if (lat === null || lng === null) {
    return NextResponse.json({ error: 'address or lat/lng required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hub_geofences')
    .insert({
      company_id: auth.company_id,
      name,
      address: address || null,
      lat,
      lng,
      radius_m: radiusM > 0 ? radiusM : 137,
      created_by: auth.user.id,
    })
    .select('id, name, address, lat, lng, radius_m, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
