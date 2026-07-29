import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/contacts/:id/merge   body: { into: <winnerId> }
//
// Merges the contact at :id (the loser — the one you're viewing) INTO the
// `into` contact (the winner, which survives). All texts, calls, voicemails,
// email history, tags, and notes move to the winner; the loser is soft-deleted.
// The heavy lifting is a single transactional Postgres function
// (public.merge_contacts) so the repoint across ~11 tables is atomic.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: loser } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const winner = typeof body.into === 'string' ? body.into.trim() : ''
  if (!winner) return NextResponse.json({ error: 'Missing target contact (into)' }, { status: 400 })
  if (winner === loser) return NextResponse.json({ error: 'Cannot merge a contact into itself' }, { status: 400 })

  // Both contacts must be live and in the caller's company. RLS scopes the
  // read; the explicit company check mirrors the edit/delete routes.
  const { data: rows } = await supabase
    .from('txt_contacts')
    .select('id, company_id')
    .in('id', [loser, winner])
    .is('deleted_at', null)
  const found = new Map((rows ?? []).map(r => [r.id, r.company_id]))
  if (!found.has(loser) || !found.has(winner)) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  if (found.get(loser) !== profile.company_id || found.get(winner) !== profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('merge_contacts', {
    p_winner: winner,
    p_loser: loser,
    p_company: profile.company_id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, winner })
}
