import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

const RESTRICTED_FIELDS = new Set([
  'role',
  'can_admin_people',
  'can_admin_hub',
  'can_admin_guardian',
  'can_admin_ai',
  'can_admin_txt',
  'can_admin_announcements',
  'can_admin_file_tags',
  'can_admin_routing',
  'can_admin_timesheet',
  'can_admin_fleet',
  'can_admin_daily_log',
  'can_admin_zone_sizer',
  'can_admin_dialer',
  'can_admin_contacts',
  'can_admin_integrations',
  'can_admin_marketing',
  'can_admin_email',
  'can_admin_forms',
  'can_admin_products',
  'guardian_tier',
])

// Editable-field allowlist for PATCH. The body must never be spread raw into
// the update — that would mass-assign anything a caller names (company_id,
// locked_at, deactivated_at, invite_sent_at, …). Permission toggles all follow
// the can_* naming (can_access_* / can_admin_* / can_post_shout_outs), so new
// toggles keep working automatically; everything else editable is named
// explicitly. display_name/full_name are handled separately below.
const EDITABLE_PATTERN = /^can_[a-z0-9_]+$/
const EDITABLE_EXACT = new Set(['role', 'guardian_tier'])

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('people')
  if (!check.ok || !check.user || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json()

  // Only super-admins can grant manager role or toggle can_admin_* flags
  const touchesRestricted = Object.keys(body).some(k => RESTRICTED_FIELDS.has(k))
  if (touchesRestricted && !check.isSuperAdmin) {
    return NextResponse.json({ error: 'Only full admins can change role or admin access grants' }, { status: 403 })
  }

  const admin = createAdminClient()

  // display_name lives on hub_users — pull it out and write separately
  const { display_name, full_name, ...profileFields } = body

  const notEditable = Object.keys(profileFields).filter(
    k => !EDITABLE_PATTERN.test(k) && !EDITABLE_EXACT.has(k)
  )
  if (notEditable.length > 0) {
    return NextResponse.json({ error: `Not an editable field: ${notEditable.join(', ')}` }, { status: 400 })
  }

  // All writes are scoped to the admin's own company — an id outside it is a no-op.
  if (display_name !== undefined) {
    await admin
      .from('hub_users')
      .update({ display_name: display_name || null })
      .eq('id', id)
      .eq('company_id', check.company_id)
  }

  // full_name and everything else (role, permissions) lives on user_profiles
  const profileUpdates: Record<string, unknown> = { ...profileFields, updated_at: new Date().toISOString() }
  if (full_name !== undefined) profileUpdates.full_name = full_name || null

  const { data, error } = await admin
    .from('user_profiles')
    .update(profileUpdates)
    .eq('id', id)
    .eq('company_id', check.company_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('people')
  if (!check.ok || !check.user || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (check.user.id === id) {
    return NextResponse.json({ error: 'Cannot remove your own account' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Company scope: a target with a profile in another company is invisible here.
  // (A profile-less orphan auth account is still removable — nothing to scope on.)
  const { data: target } = await admin
    .from('user_profiles')
    .select('company_id')
    .eq('id', id)
    .maybeSingle()
  if (target && target.company_id !== check.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Remove is for accounts that never became real people (typo emails, test
  // accounts). Anyone who has signed in has history — Deactivate them instead.
  const { data: authUser } = await admin.auth.admin.getUserById(id)
  if (authUser?.user?.last_sign_in_at) {
    return NextResponse.json(
      { error: 'This person has signed in before — use Deactivate instead so their history is kept' },
      { status: 400 }
    )
  }

  await admin.from('user_profiles').delete().eq('id', id)

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
