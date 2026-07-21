import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveDispositions } from '@/lib/dialer-dispositions'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// GET /api/dialer/settings/dispositions
// The company's after-call disposition options (falls back to the built-in
// default set). Any Dialer user can read it — it drives the hang-up prompt.
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
    .select('disposition_options, dispositions_enabled')
    .eq('company_id', profile.company_id || HEROES_COMPANY_ID)
    .maybeSingle()

  return NextResponse.json({
    options: resolveDispositions(row?.disposition_options),
    // Default ON: only an explicit `false` hides the after-call prompt, so a
    // company that never set the flag (null row) keeps today's behavior.
    enabled: row?.dispositions_enabled !== false,
  })
}
