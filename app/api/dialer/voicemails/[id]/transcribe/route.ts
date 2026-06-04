import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processVoicemail } from '@/lib/voicemail-transcribe'

export const dynamic = 'force-dynamic'
// Voicemail transcriptions can take 10–30s for Deepgram + Claude.
export const maxDuration = 60

// POST /api/dialer/voicemails/[id]/transcribe
//
// Runs (or re-runs) the Deepgram + Claude transcription pipeline for one
// voicemail. Authorized by cron-secret header OR a manager/admin session.
// Pass ?force=1 to re-run even if transcript is already populated.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cronSecret = request.headers.get('x-cron-secret')

  if (cronSecret) {
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
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

  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === '1'

  if (force) {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    await admin.from('voicemails').update({ transcript: null, summary: null }).eq('id', id)
  }

  const result = await processVoicemail(id)
  return NextResponse.json(result)
}
