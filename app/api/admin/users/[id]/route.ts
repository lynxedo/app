import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

const RESTRICTED_FIELDS = new Set([
  'role',
  'can_admin_people',
  'can_admin_hub',
  'can_admin_routing',
  'can_admin_timesheet',
  'can_admin_fleet',
  'can_admin_daily_log',
  'can_admin_zone_sizer',
  'can_admin_dialer',
  'can_admin_contacts',
  'guardian_tier',
])

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('people')
  if (!check.ok || !check.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  if (display_name !== undefined) {
    await admin.from('hub_users').update({ display_name: display_name || null }).eq('id', id)
  }

  // full_name and everything else (role, permissions) lives on user_profiles
  const profileUpdates: Record<string, unknown> = { ...profileFields, updated_at: new Date().toISOString() }
  if (full_name !== undefined) profileUpdates.full_name = full_name || null

  const { data, error } = await admin
    .from('user_profiles')
    .update(profileUpdates)
    .eq('id', id)
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
  if (!check.ok || !check.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (check.user.id === id) {
    return NextResponse.json({ error: 'Cannot remove your own account' }, { status: 400 })
  }

  const admin = createAdminClient()
  await admin.from('user_profiles').delete().eq('id', id)

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
