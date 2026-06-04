import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET /api/dialer/voicemails?scope=mine|all|unheard|mine_unheard&limit=N
//
// Scopes (Session 60):
//   mine          — owner_user_id IS NULL (general box) OR owner_user_id = me
//   all           — every voicemail in the company (manager-only)
//   unheard       — all + heard_at IS NULL (manager-only; legacy compat for
//                   the Session 58.5 rail badge hook — managers see global
//                   count, regular users get redirected to mine_unheard)
//   mine_unheard  — mine + heard_at IS NULL
//
// Manager = role='admin' OR can_admin_dialer. Non-managers requesting `all`
// or `unheard` are silently downgraded to the mine variants. RLS on the
// voicemails table is company-scoped, so even a manager only sees their
// company's rows.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_dialer, can_admin_dialer, role')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const isManager = profile.role === 'admin' || Boolean(profile.can_admin_dialer)

  const { searchParams } = new URL(request.url)
  const rawScope = searchParams.get('scope') || 'all'
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)

  // Resolve scope with downgrade for non-managers.
  let scope: 'mine' | 'all' | 'unheard' | 'mine_unheard'
  if (rawScope === 'mine' || rawScope === 'mine_unheard') {
    scope = rawScope
  } else if (rawScope === 'all') {
    scope = isManager ? 'all' : 'mine'
  } else if (rawScope === 'unheard') {
    scope = isManager ? 'unheard' : 'mine_unheard'
  } else {
    scope = isManager ? 'all' : 'mine'
  }

  let query = supabase
    .from('voicemails')
    .select(`
      id,
      created_at,
      from_number,
      recording_duration_sec,
      heard_at,
      heard_by,
      owner_user_id,
      call_id,
      transcript,
      summary,
      contact:txt_contacts(id, name, phone)
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (scope === 'mine' || scope === 'mine_unheard') {
    // owner IS NULL OR owner = me. Supabase JS doesn't have a clean OR-IS-NULL
    // helper, so use the .or() string builder.
    query = query.or(`owner_user_id.is.null,owner_user_id.eq.${user.id}`)
  }
  if (scope === 'unheard' || scope === 'mine_unheard') {
    query = query.is('heard_at', null)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Unheard count: when the user is on a "mine" view, count their unheard
  // (general + theirs). Otherwise count company-wide unheard.
  const admin = createAdminClient()
  let unheardQuery = admin
    .from('voicemails')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', profile.company_id!)
    .is('deleted_at', null)
    .is('heard_at', null)
  if (scope === 'mine' || scope === 'mine_unheard') {
    unheardQuery = unheardQuery.or(`owner_user_id.is.null,owner_user_id.eq.${user.id}`)
  }
  const { count: unheardCount } = await unheardQuery

  return NextResponse.json({
    voicemails: data ?? [],
    unheard_count: unheardCount ?? 0,
    is_manager: isManager,
  })
}
