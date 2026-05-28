import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_marketing')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_marketing || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const admin = createAdminClient()

  // Verify post belongs to company and is editable
  const { data: existing } = await admin
    .from('social_posts')
    .select('id, status')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'published') {
    return NextResponse.json({ error: 'Cannot edit a published post' }, { status: 409 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.caption === 'string') updates.caption = body.caption.trim()
  if (body.scheduled_at) updates.scheduled_at = body.scheduled_at
  if (body.hub_file_id !== undefined) updates.hub_file_id = body.hub_file_id ?? null
  if (body.platforms && Array.isArray(body.platforms)) updates.platforms = body.platforms
  if (body.status === 'draft' || body.status === 'scheduled') updates.status = body.status

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('social_posts')
    .update(updates)
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .select('id, account_id, hub_file_id, caption, scheduled_at, status, platforms')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ post: data })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_marketing')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_marketing || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('social_posts')
    .select('status')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'published') {
    return NextResponse.json({ error: 'Cannot delete a published post' }, { status: 409 })
  }

  const { error } = await admin
    .from('social_posts')
    .delete()
    .eq('id', id)
    .eq('company_id', profile.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
