import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// PATCH /api/dialer/voicemails/[id]  — mark heard / unheard and/or set the
// follow-up marker.
// Body: { heard?: boolean; followUp?: 'resolved' | 'follow_up' | null }
//   followUp: 'resolved' = ✓ taken care of, 'follow_up' = 🚩 needs follow-up,
//   null = clear the marker.
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

  let body: { heard?: boolean; followUp?: 'resolved' | 'follow_up' | null }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Validate the follow-up marker up front (null = clear).
  if ('followUp' in body && body.followUp !== null
    && body.followUp !== 'resolved' && body.followUp !== 'follow_up') {
    return NextResponse.json(
      { error: "followUp must be 'resolved', 'follow_up', or null" },
      { status: 400 },
    )
  }

  // Look up the hub_users.id for this auth user (for heard_by / follow_up_by).
  const admin = createAdminClient()
  const { data: hubUser } = await admin
    .from('hub_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('company_id', profile.company_id)
    .maybeSingle()

  // Build the patch conditionally so a heard-toggle never clobbers the follow-up
  // marker (and vice versa) — only fields present in the body are written.
  const patch: Record<string, unknown> = {}
  if ('heard' in body) {
    Object.assign(patch, body.heard
      ? { heard_at: new Date().toISOString(), heard_by: hubUser?.id ?? null }
      : { heard_at: null, heard_by: null })
  }
  if ('followUp' in body) {
    Object.assign(patch, body.followUp
      ? { follow_up_status: body.followUp, follow_up_by: hubUser?.id ?? null, follow_up_at: new Date().toISOString() }
      : { follow_up_status: null, follow_up_by: null, follow_up_at: null })
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('voicemails')
    .update(patch)
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .is('deleted_at', null)
    .select('id, heard_at, heard_by, follow_up_status, follow_up_by, follow_up_at')
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
