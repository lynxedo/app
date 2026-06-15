import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SCOREBOARDS } from '@/lib/scoreboards/registry'

// Admin-only: grant/revoke which BOARDS a user may view (Admin -> Scoreboards).
// This is view access, distinct from `scoreboard_technicians` (whose data appears
// on a board). The single can_access_scoreboards flag (Admin -> People) is the
// section gate; this controls per-board visibility, default nothing-until-granted.
// Writes go through the service-role client (bypasses RLS); the page reads are
// server-side with the same client.
async function getAdminCompany(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'admin' || !profile.company_id) return null
  return profile.company_id as string
}

const VALID_SLUGS = new Set(SCOREBOARDS.map(b => b.slug))

export async function POST(request: Request) {
  const company = await getAdminCompany()
  if (!company) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { user_id?: string; board_slug?: string; granted?: boolean }
  const userId = String(body.user_id || '').trim()
  const boardSlug = String(body.board_slug || '').trim()
  const granted = !!body.granted
  if (!userId || !boardSlug) {
    return NextResponse.json({ error: 'user_id and board_slug are required' }, { status: 400 })
  }
  if (!VALID_SLUGS.has(boardSlug)) {
    return NextResponse.json({ error: 'Unknown board' }, { status: 404 })
  }

  const admin = createAdminClient()

  // Guard: the target user must belong to this company.
  const { data: target } = await admin
    .from('user_profiles').select('id').eq('id', userId).eq('company_id', company).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Unknown user' }, { status: 404 })

  if (granted) {
    const { error } = await admin
      .from('scoreboard_board_access')
      .upsert(
        { company_id: company, user_id: userId, board_slug: boardSlug },
        { onConflict: 'company_id,user_id,board_slug' }
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await admin
      .from('scoreboard_board_access')
      .delete()
      .eq('company_id', company)
      .eq('user_id', userId)
      .eq('board_slug', boardSlug)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
