import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getNeighborhoodMap,
  kmlTextFromUpload,
  lookupNeighborhood,
  parseNeighborhoodKml,
} from '@/lib/neighborhood-map'

// Admin → AI → Knowledge → Neighborhood map. GET summarises the stored map,
// POST (multipart, field "file") replaces it with an uploaded KML/KMZ, and PUT
// {address} tests one address against it. Gated requireAdminArea('ai') like the
// rest of the AI admin area; reads/writes use the service-role client, scoped by
// the caller's company.

const MAX_BYTES = 5 * 1024 * 1024

export async function GET() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const map = await getNeighborhoodMap(createAdminClient(), auth.company_id!)
  return NextResponse.json({
    map: map
      ? { names: map.areas.map((a) => a.name), fileName: map.fileName, uploadedAt: map.uploadedAt }
      : null,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Choose a .kml or .kmz file to upload.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 5 MB — is it the right map?' }, { status: 400 })
  }

  let areas
  try {
    const kml = kmlTextFromUpload(Buffer.from(await file.arrayBuffer()))
    areas = parseNeighborhoodKml(kml)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'That file could not be read.' }, { status: 400 })
  }
  if (!areas.length) {
    return NextResponse.json(
      { error: 'No neighborhood shapes were found in that file. Export the map layer that has the drawn areas (not pins).' },
      { status: 400 },
    )
  }

  const { error } = await createAdminClient()
    .from('neighborhood_maps')
    .upsert(
      {
        company_id: auth.company_id!,
        areas,
        file_name: file.name.slice(0, 200),
        uploaded_at: new Date().toISOString(),
        uploaded_by: auth.user?.id ?? null,
      },
      { onConflict: 'company_id' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    map: { names: areas.map((a) => a.name), fileName: file.name, uploadedAt: new Date().toISOString() },
  })
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { address?: unknown }
  const address = typeof body.address === 'string' ? body.address.trim().slice(0, 300) : ''
  if (!address) return NextResponse.json({ error: 'Type an address to test.' }, { status: 400 })

  const result = await lookupNeighborhood(createAdminClient(), auth.company_id!, address)
  return NextResponse.json({ result })
}
