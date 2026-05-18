import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return profile?.role === 'admin' ? user : null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json()
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
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (adminUser.id === id) {
    return NextResponse.json({ error: 'Cannot remove your own account' }, { status: 400 })
  }

  const admin = createAdminClient()
  await admin.from('user_profiles').delete().eq('id', id)

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
