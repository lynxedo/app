import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

async function requireAdmin() {
  const check = await requireAdminArea('people')
  return check.ok && check.user
    ? { id: check.user.id, company_id: check.company_id }
    : null
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Track 1 — the admin client below bypasses RLS; a caller with no company can't invite anyone.
  if (!adminUser.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  // Track 1 — verify the target belongs to the caller's company before re-inviting;
  // a cross-company id answers exactly like a missing user.
  const { data: targetProfile } = await admin
    .from('user_profiles')
    .select('company_id')
    .eq('id', id)
    .maybeSingle()
  if (!targetProfile || targetProfile.company_id !== adminUser.company_id) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Look up the user's email
  const { data: { user }, error: lookupError } = await admin.auth.admin.getUserById(id)
  if (lookupError || !user?.email) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Re-invite — Supabase resends the email to an existing unconfirmed user
  const { error } = await admin.auth.admin.inviteUserByEmail(user.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark invite as sent
  await admin
    .from('user_profiles')
    .update({ invite_sent_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
