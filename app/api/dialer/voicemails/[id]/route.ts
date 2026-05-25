import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// PATCH /api/dialer/voicemails/[id]  — mark heard / unheard
// Body: { heard: boolean }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_dialer')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { heard?: boolean }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Look up the hub_users.id for this auth user (for heard_by stamp).
  const admin = createAdminClient()
  const { data: hubUser } = await admin
    .from('hub_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('company_id', profile.company_id)
    .maybeSingle()

  const patch = body.heard
    ? { heard_at: new Date().toISOString(), heard_by: hubUser?.id ?? null }
    : { heard_at: null, heard_by: null }

  const { data, error } = await admin
    .from('voicemails')
    .update(patch)
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .is('deleted_at', null)
    .select('id, heard_at, heard_by')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ voicemail: data })
}

// DELETE /api/dialer/voicemails/[id]  — soft delete
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_dialer')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: hubUser } = await admin
    .from('hub_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('company_id', profile.company_id)
    .maybeSingle()

  const { error } = await admin
    .from('voicemails')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: hubUser?.id ?? null,
    })
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
