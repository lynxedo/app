import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// List calls for the dialer's Recent / Missed tabs.
// Scopes:
//   - mine: calls where handled_by/initiated_by is the caller
//   - missed: status in ('no-answer','busy','failed','canceled') AND direction='inbound'
//   - all: everything (managers only — has can_admin_dialer OR can_admin_hub OR role=admin)
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, can_admin_dialer, can_admin_hub, role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const isManager =
    profile.role === 'admin' || !!profile.can_admin_dialer || !!profile.can_admin_hub

  const { searchParams } = new URL(request.url)
  const scope = (searchParams.get('scope') || 'mine') as 'mine' | 'missed' | 'all'
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)

  if ((scope === 'all') && !isManager) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  let q = admin
    .from('calls')
    .select(
      'id, direction, from_number, to_number, status, duration_seconds, created_at, answered_at, ended_at, handled_by, initiated_by, recording_url, contact:txt_contacts!contact_id(id, name, phone), conversation_id'
    )
    .eq('company_id', profile.company_id || '')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (scope === 'mine') {
    q = q.or(`handled_by.eq.${user.id},initiated_by.eq.${user.id}`)
  } else if (scope === 'missed') {
    q = q
      .in('status', ['no-answer', 'busy', 'failed', 'canceled'])
      .eq('direction', 'inbound')
  }

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ calls: data ?? [] })
}
