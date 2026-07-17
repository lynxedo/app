import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const updates: Record<string, unknown> = {}

  if (typeof body.name === 'string') updates.name = body.name.trim()
  if (typeof body.description === 'string') updates.description = body.description.trim() || null
  if (body.archive === true) updates.archived_at = new Date().toISOString()
  if (body.archive === false) updates.archived_at = null
  if (typeof body.claude_enabled === 'boolean') updates.claude_enabled = body.claude_enabled
  if (typeof body.is_private === 'boolean') updates.is_private = body.is_private

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Track 1 — the admin client bypasses RLS; 404 unless the room is in the caller's company
  const { data: room } = await admin.from('rooms').select('company_id').eq('id', id).maybeSingle()
  if (!room || room.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin.from('rooms').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
