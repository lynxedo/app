import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { geocodeAddress } from '@/lib/geocode'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const body = await request.json()
  const patch: Record<string, unknown> = {}

  if (typeof body.name === 'string') patch.name = body.name.trim()
  if (Number.isFinite(body.radius_m)) patch.radius_m = Math.max(1, Math.round(body.radius_m))
  if (typeof body.address === 'string') {
    const address = body.address.trim()
    patch.address = address || null
    if (address) {
      const geo = await geocodeAddress(address)
      if (!geo) {
        return NextResponse.json({ error: 'Could not find that address.' }, { status: 422 })
      }
      patch.lat = geo.lat
      patch.lng = geo.lng
    }
  }
  if (typeof body.lat === 'number') patch.lat = body.lat
  if (typeof body.lng === 'number') patch.lng = body.lng

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hub_geofences')
    .update(patch)
    .eq('id', id)
    .eq('company_id', auth.company_id)
    .select('id, name, address, lat, lng, radius_m, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const admin = createAdminClient()
  const { error } = await admin
    .from('hub_geofences')
    .delete()
    .eq('id', id)
    .eq('company_id', auth.company_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
