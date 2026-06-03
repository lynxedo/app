import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processPendingCall } from '@/lib/call-transcribe'

export const dynamic = 'force-dynamic'

// POST /api/dialer/calls/[id]/transcribe
//
// Runs the dual-engine transcription pipeline for one recorded call. Two
// callers:
//   1. The recording webhook fires this fire-and-forget (with x-cron-secret)
//      the moment a recording lands in R2 — fast path.
//   2. A manager can trigger / re-run it from the UI (session-authed).
//
// The 1-min cron at /api/dialer/calls/transcribe/process is the reliability
// backstop that sweeps any pending rows this missed.
//
// Auth: x-cron-secret == CRON_SECRET (internal) OR an authenticated dialer
// manager session. The work runs inline (this lives on the long-running PM2
// server, not a serverless function, so a non-awaited caller still completes).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === '1'

  const cronSecret = request.headers.get('x-cron-secret')
  const isInternal = Boolean(cronSecret && cronSecret === process.env.CRON_SECRET)

  if (!isInternal) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, can_admin_dialer, can_admin_hub, can_access_dialer')
      .eq('id', user.id)
      .single()
    const isManager =
      profile?.role === 'admin' || !!profile?.can_admin_dialer || !!profile?.can_admin_hub
    if (!profile?.can_access_dialer || !isManager) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  try {
    const result = await processPendingCall(id, { force })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'transcription failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.calls.transcribe' })
}
