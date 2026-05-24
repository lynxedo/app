import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const LAWN_API = 'http://localhost:8000/estimate'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_zone_sizer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_zone_sizer || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { address?: string } | null
  const address = body?.address?.trim()
  if (!address) return NextResponse.json({ error: 'Address is required' }, { status: 400 })

  // Always run advanced mode for irrigation quoting — accuracy matters more
  // than the extra ~15s.
  const upstream = await fetch(LAWN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, mode: 'advanced' }),
  })

  const data = await upstream.json()
  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status })
  }

  const admin = createAdminClient()
  const { data: settingsRow } = await admin
    .from('zone_sizer_settings')
    .select('turf_sqft_per_zone, bed_sqft_per_zone')
    .eq('company_id', profile.company_id)
    .maybeSingle()

  const turfPerZone = settingsRow?.turf_sqft_per_zone ?? 1000
  const bedPerZone  = settingsRow?.bed_sqft_per_zone  ?? 1000

  const turfSqft = Number(data?.adjusted_lawn_sqft ?? data?.visible_lawn_sqft ?? 0)
  const bedSqft  = Number(data?.bed_sqft ?? 0)

  const lawnZones = turfSqft > 0 ? Math.ceil(turfSqft / turfPerZone) : 0
  const bedZones  = bedSqft  > 0 ? Math.ceil(bedSqft  / bedPerZone)  : 0

  return NextResponse.json({
    address: data?.address ?? address,
    lat: data?.lat,
    lon: data?.lon,
    tile_url: data?.tile_url,
    turf_sqft: turfSqft,
    bed_sqft: bedSqft,
    lawn_zones: lawnZones,
    bed_zones: bedZones,
    turf_sqft_per_zone: turfPerZone,
    bed_sqft_per_zone: bedPerZone,
    confidence: data?.confidence ?? null,
    flag_reason: data?.flag_reason ?? null,
    canopy_pct: data?.canopy_pct ?? 0,
    parcel_source: data?.parcel_source ?? 'none',
    lot_sqft: data?.lot_sqft ?? 0,
    runtime_ms: data?.runtime_ms ?? null,
  })
}
