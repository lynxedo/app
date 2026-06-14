import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { geocodeAddresses } from '@/lib/geocode'
import { withApiHandler, readJson, ApiError } from '@/lib/api'

// #30 — one source of truth for coordinates. The route map used to geocode addresses
// in the browser via Mapbox while the optimizer geocoded them server-side via the US
// Census geocoder (lib/geocode.ts) + cache — so pins jumped when you hit Optimize and
// the drawn route didn't match the displayed pins. This endpoint exposes the SAME
// server geocoder/cache the optimizer uses, so the map and the optimizer agree.
export const POST = withApiHandler(async (request) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readJson<{ addresses?: unknown }>(request)
  const addresses = body?.addresses
  if (!Array.isArray(addresses) || addresses.some(a => typeof a !== 'string')) {
    throw new ApiError('addresses must be an array of strings', 400)
  }

  const coords = await geocodeAddresses(addresses as string[])
  return NextResponse.json({ coords })
})
