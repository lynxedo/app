import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processVoicemail } from '@/lib/voicemail-transcribe'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/dialer/voicemails/transcribe/process
//
// 1-minute cron backstop: sweeps voicemails that have a recording but no
// transcript yet and runs the transcription pipeline on each. Processes up to
// 5 per run so a single slow cron invocation can't pile up.
//
// Auth: x-cron-secret header (same secret as every other cron route) OR an
// admin/manager session (for manual ad-hoc sweeps from the browser).
export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('x-cron-secret')

  if (cronSecret) {
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('can_admin_dialer, role')
      .eq('id', user.id)
      .single()
    if (!profile?.can_admin_dialer && profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const admin = createAdminClient()

  // Find up to 5 voicemails that have audio but no transcript yet.
  const { data: pending } = await admin
    .from('voicemails')
    .select('id')
    .not('recording_storage_path', 'is', null)
    .is('transcript', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5)

  const ids = (pending ?? []).map((r: { id: string }) => r.id)
  if (ids.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  const results = await Promise.allSettled(ids.map((id: string) => processVoicemail(id)))

  const processed = results.filter(
    (r) => r.status === 'fulfilled' && !(r.value as { error?: string | null }).error
  ).length

  console.log(`[voicemail-transcribe/process] swept ${ids.length}, processed ${processed}`)
  return NextResponse.json({ processed, total: ids.length })
}
