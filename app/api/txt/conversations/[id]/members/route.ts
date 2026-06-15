import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTxtConvPermissions } from '@/lib/txt-permissions'
import { sendHubPush } from '@/lib/hub-push'

// POST /api/txt/conversations/[id]/members  — add a member
// DELETE /api/txt/conversations/[id]/members?user_id=... — remove a member
//
// Adding/removing OTHER people is owner/manager only. But ANY Txt2 user may
// add THEMSELVES (self-join) so they get a voice in a shared-inbox thread
// without waiting to be added. Members can text + add notes but not archive or
// change ownership; a member may always remove themselves.

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
  // Owner/manager can add anyone; any Txt2 user can self-join.
  const isSelfJoin = targetUserId === user.id && perms.isTxtUser
  if (!perms.canManageMembers && !isSelfJoin) {
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

  // Notify the newly added teammate — but only on a fresh add (skip the
  // duplicate case, which means they were already on the thread) and never on
  // a self-join (no point pinging yourself).
  if (!error && targetUserId !== user.id) {
    try {
      const [{ data: conv }, { data: adder }] = await Promise.all([
        admin
          .from('txt_conversations')
          .select(
            `kind, contact:txt_contacts!txt_conversations_contact_id_fkey ( name, phone )`
          )
          .eq('id', id)
          .maybeSingle(),
        admin.from('hub_users').select('display_name').eq('id', user.id).maybeSingle(),
      ])
      const contact = conv
        ? Array.isArray(conv.contact)
          ? conv.contact[0]
          : conv.contact
        : null
      const convLabel =
        conv?.kind === 'group'
          ? 'a group text'
          : contact?.name?.trim() || contact?.phone || 'a text conversation'
      const adderName = adder?.display_name?.split(/\s+/)[0] || 'A teammate'
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
      // Fire-and-forget so the add response isn't blocked on push delivery.
      sendHubPush(
        [targetUserId],
        {
          title: 'Added to a text conversation',
          body: `${adderName} added you to ${convLabel}`,
          url: `${baseUrl}/hub/txt/${id}?source=push`,
        },
        { isDm: true }
      ).catch((e) => console.warn('[txt:members] add-notify push failed', e))
    } catch (e) {
      console.warn('[txt:members] add-notify lookup failed', e)
    }
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
