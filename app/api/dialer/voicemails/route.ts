import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET /api/dialer/voicemails?scope=all|unheard&limit=N
// Lists company voicemails. RLS enforces company scope so the user-session
// client is fine here.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_dialer')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') || 'all'
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)

  let query = supabase
    .from('voicemails')
    .select(`
      id,
      created_at,
      from_number,
      recording_duration_sec,
      heard_at,
      heard_by,
      call_id,
      contact:txt_contacts(id, name, phone)
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (scope === 'unheard') {
    query = query.is('heard_at', null)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Compute unheard count separately for the badge in the sidebar tab.
  const admin = createAdminClient()
  const { count: unheardCount } = await admin
    .from('voicemails')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', profile.company_id!)
    .is('deleted_at', null)
    .is('heard_at', null)

  return NextResponse.json({
    voicemails: data ?? [],
    unheard_count: unheardCount ?? 0,
  })
}
