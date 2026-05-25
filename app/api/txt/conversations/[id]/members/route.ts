import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTxtConvPermissions } from '@/lib/txt-permissions'

// POST /api/txt/conversations/[id]/members  — add a member
// DELETE /api/txt/conversations/[id]/members?user_id=... — remove a member
//
// Only the conversation owner or a Txt manager can add/remove members.
// Members can text + add notes but not archive or change ownership.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const targetUserId: string | null = body.user_id || null
  if (!targetUserId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  const perms = await getTxtConvPermissions(supabase, id, user.id)
  if (!perms.canManageMembers) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('txt_conversation_members')
    .insert({
      conversation_id: id,
      user_id: targetUserId,
      role: 'member',
      added_by: user.id,
    })

  // Ignore duplicate-primary-key (user already on this conv); surface anything else.
  if (error && error.code !== '23505') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const url = new URL(request.url)
  const targetUserId = url.searchParams.get('user_id')
  if (!targetUserId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  const perms = await getTxtConvPermissions(supabase, id, user.id)
  // Owner / manager can remove anyone (except: cannot remove the owner via
  // this route — owner change goes through /assign). A member may remove
  // themselves so they can stop getting noise.
  const isSelfRemoval = targetUserId === user.id
  if (!perms.canManageMembers && !isSelfRemoval) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('txt_conversation_members')
    .delete()
    .eq('conversation_id', id)
    .eq('user_id', targetUserId)
    .eq('role', 'member')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
