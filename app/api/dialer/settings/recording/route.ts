import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// GET /api/dialer/settings/recording
// Returns recording-specific dialer settings accessible to any Dialer user.
// Used by DialerPanel to know whether to show the recording indicator + pause button.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('dialer_settings')
    .select('recording_enabled, recording_pause_auto_resume_sec')
    .eq('company_id', profile.company_id || HEROES_COMPANY_ID)
    .maybeSingle()

  return NextResponse.json({
    recording_enabled: row?.recording_enabled ?? false,
    recording_pause_auto_resume_sec: row?.recording_pause_auto_resume_sec ?? 60,
  })
}
