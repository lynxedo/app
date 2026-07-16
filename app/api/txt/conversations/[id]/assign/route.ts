import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { seizeAmberThreadForHuman } from '@/lib/amber-text'

// POST /api/txt/conversations/[id]/assign
// Body: { assigned_to: string|null }
//
// Sets the OWNER of this conversation. Owner mirrors the legacy
// txt_conversations.assigned_to column AND writes a row in
// txt_conversation_members so the new member list stays correct.
//
// Permission: managers can set any owner; anyone can self-claim an
// unassigned thread. Existing owners can hand off ownership.
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
  const assignTo: string | null =
    body.assigned_to === null ? null : body.assigned_to || null

  const [{ data: profile }, { data: conv }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('role, can_admin_txt, can_assign_txt_threads, can_access_txt')
      .eq('id', user.id)
      .single(),
    supabase
      .from('txt_conversations')
      .select('id, assigned_to, status')
      .eq('id', id)
      .single(),
  ])

  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true
  const isTxtUser = isManager || profile?.can_access_txt === true
  const isCurrentOwner = conv.assigned_to === user.id
  const isSelfClaim = assignTo === user.id && conv.status === 'unassigned'

  // Any Txt2 user can (re)assign across the shared inbox.
  if (!isTxtUser && !isCurrentOwner && !isSelfClaim) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Amber-over-text seize: a human claiming/assigning the thread takes it over,
  // so Amber goes silent. No-op unless Amber is actively driving it. Best-effort.
  await seizeAmberThreadForHuman(admin, { conversationId: id, userId: user.id })

  const newStatus = assignTo ? 'assigned' : 'unassigned'

  // Drop the prior owner row (if any). Members keep their seat — handing
  // off ownership shouldn't bump existing collaborators.
  await admin
    .from('txt_conversation_members')
    .delete()
    .eq('conversation_id', id)
    .eq('role', 'owner')

  if (assignTo) {
    // upsert in case the new owner was previously a member; promote them.
    await admin.from('txt_conversation_members').delete().match({
      conversation_id: id,
      user_id: assignTo,
    })
    const { error: memberErr } = await admin
      .from('txt_conversation_members')
      .insert({
        conversation_id: id,
        user_id: assignTo,
        role: 'owner',
        added_by: user.id,
      })
    if (memberErr) {
      return NextResponse.json({ error: memberErr.message }, { status: 500 })
    }
  }

  const { data: updated, error } = await admin
    .from('txt_conversations')
    .update({ assigned_to: assignTo, status: newStatus })
    .eq('id', id)
    .select('id, status, assigned_to')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, conversation: updated })
}
