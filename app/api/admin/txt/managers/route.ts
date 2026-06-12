import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/admin/txt/managers
// Body: { manager_user_ids: string[] }
//
// Sets the per-user `can_assign_txt_threads` grant — the "Texting Manager"
// tier. Managers can see the unassigned Queue + the Responder tab and send
// Broadcasts. Everyone else with Txt2 access still works the shared inbox
// (Mine/All/Archived, reassign, notes, AI, archive, group messages).
//
// Admins and Txt-admins are always managers regardless of this flag, so the
// picker only toggles non-admin users.
export async function POST(request: Request) {
  const auth = await requireAdminArea('txt')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const ids = body.manager_user_ids
  if (!Array.isArray(ids) || ids.some((x: unknown) => typeof x !== 'string')) {
    return NextResponse.json(
      { error: 'manager_user_ids must be an array of user ids' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // 1) Revoke from everyone in this company who currently has the grant.
  const { error: revokeErr } = await admin
    .from('user_profiles')
    .update({ can_assign_txt_threads: false })
    .eq('company_id', auth.company_id)
    .eq('can_assign_txt_threads', true)
  if (revokeErr) {
    return NextResponse.json({ error: revokeErr.message }, { status: 500 })
  }

  // 2) Grant to the selected users (scoped to this company).
  if (ids.length > 0) {
    const { error: grantErr } = await admin
      .from('user_profiles')
      .update({ can_assign_txt_threads: true })
      .eq('company_id', auth.company_id)
      .in('id', ids)
    if (grantErr) {
      return NextResponse.json({ error: grantErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
