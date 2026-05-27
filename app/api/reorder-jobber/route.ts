import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setRouteOrder } from '@/lib/jobber-playwright'

// Playwright launches Chromium — must run in the Node.js runtime.
export const runtime = 'nodejs'
// Browser launch + login + N mutations can take 10–30s on a cold call.
export const maxDuration = 60

interface ReorderRequest {
  visit_ids?: unknown
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: ReorderRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const raw = body.visit_ids
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: 'visit_ids must be a non-empty array' }, { status: 400 })
  }
  if (raw.some(v => typeof v !== 'string' || v.length === 0)) {
    return NextResponse.json({ error: 'visit_ids must be strings' }, { status: 400 })
  }
  if (raw.length > 50) {
    return NextResponse.json({ error: 'Too many visits (max 50 per request)' }, { status: 400 })
  }
  const visitIds = raw as string[]

  try {
    const results = await setRouteOrder(visitIds)
    const allOk = results.every(r => r.success)
    return NextResponse.json({ results, allOk })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
