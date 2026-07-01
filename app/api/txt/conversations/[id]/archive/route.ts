import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTxtConvPermissions } from '@/lib/txt-permissions'

// POST /api/txt/conversations/[id]/archive — body { archived: true|false }
//
// ARCHIVING (archived:true) is owner-level — only the owner or a Txt manager can
// hide a thread from everyone's active inbox (`canArchive`).
//
// REOPENING (archived:false) is open to any Txt teammate (`canUnarchive`) — a rep
// needs to re-engage an archived customer, and reopening is low-stakes/reversible.
// On reopen of a DIRECT thread we ALSO claim it for the reopener (they become the
// owner) so the composer appears in one tap — mirrors the ownership bookkeeping in
// the assign route (one owner row + assigned_to). Groups have no single owner, so
// they just return to the active inbox.
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
  const archived: boolean = body.archived !== false

  const perms = await getTxtConvPermissions(supabase, id, user.id)
  if (archived ? !perms.canArchive : !perms.canUnarchive) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: conv } = await supabase
    .from('txt_conversations')
    .select('kind, assigned_to, status')
    .eq('id', id)
    .single()

  const admin = createAdminClient()
  const isGroup = conv?.kind === 'group'

  let update:
    | { status: 'archived'; archived_by: string }
    | { status: 'assigned' | 'unassigned'; archived_by: null }
    | { status: 'assigned'; assigned_to: string; archived_by: null }

  if (archived) {
    update = { status: 'archived', archived_by: user.id }
  } else if (isGroup) {
    // Group: no single owner to claim — just restore it to the active inbox.
    update = {
      status: conv?.assigned_to ? 'assigned' : 'unassigned',
      archived_by: null,
    }
  } else {
    // Direct thread: claim it for the reopener so they can reply immediately.
    // Replace the owner row (drop the prior owner + any existing seat for the
    // reopener), then seat the reopener as owner — same steps as /assign.
    await admin
      .from('txt_conversation_members')
      .delete()
      .eq('conversation_id', id)
      .eq('role', 'owner')
    await admin
      .from('txt_conversation_members')
      .delete()
      .match({ conversation_id: id, user_id: user.id })
    await admin
      .from('txt_conversation_members')
      .insert({ conversation_id: id, user_id: user.id, role: 'owner', added_by: user.id })
    update = { status: 'assigned', assigned_to: user.id, archived_by: null }
  }

  const { data: updated, error } = await admin
    .from('txt_conversations')
    .update(update)
    .eq('id', id)
    .select('id, status, assigned_to')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, conversation: updated })
}
