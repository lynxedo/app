import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withApiHandler, readJson, fetchWithTimeout, ApiError } from '@/lib/api'

const LAWN_API = 'http://localhost:8000/estimate'

export const POST = withApiHandler(async (request) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Validate input up front so a malformed body fails clean (400) instead of crashing
  // the upstream call.
  const body = await readJson<{ address?: string }>(request)
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body.', 400)
  }

  // Bound the call to the local lawn-size service so a restart/hang becomes a clean
  // 504 instead of a hanging request or a raw 500.
  const upstream = await fetchWithTimeout(LAWN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 20000)

  const data = await upstream.json().catch(() => null)
  if (data === null) {
    throw new ApiError('The lawn estimate service returned an unexpected response.', 502)
  }
  return NextResponse.json(data, { status: upstream.status })
})
