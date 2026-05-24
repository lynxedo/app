import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import RoomView from '@/components/hub/RoomView'
import DMHeader from '@/components/hub/DMHeader'
import type { HubUser } from '@/components/hub/MessageFeed'

export default async function PMPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .single()

  if (!membership) notFound()

  const admin = createAdminClient()
  const [profileResult, memberIdsResult, messagesResult, hubUsersResult, allRoomsResult, receiptsResult] = await Promise.all([
    supabase.from('user_profiles').select('role').eq('id', user.id).single(),
    admin.from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId),
    supabase.from('messages')
      .select(`id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from,
        sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
        reactions (message_id, user_id, emoji),
        files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)`)
      .eq('conversation_id', conversationId)
      .is('parent_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('hub_users').select('id, display_name, avatar_url, is_bot').order('display_name'),
    supabase.from('rooms').select('id, name').is('archived_at', null).order('name'),
    // Read receipts for ALL members of this conversation — drives the
    // "Read by..." indicator under the user's most recent self-sent message.
    // RLS policy hub_read_receipts_select_dm_members allows this fetch.
    supabase.from('hub_read_receipts')
      .select('user_id, last_read_at')
      .eq('conversation_id', conversationId),
  ])

  // Fetch presence-enriched member info from the view in one batch.
  const memberIds = (memberIdsResult.data ?? []).map((m: { user_id: string }) => m.user_id)
  const { data: participantRows } = memberIds.length > 0
    ? await admin
        .from('hub_users_with_presence')
        .select('id, display_name, avatar_url, is_bot, status, effective_status')
        .in('id', memberIds)
    : { data: [] }
  const participants: HubUser[] = (participantRows ?? []) as HubUser[]

  const others = participants.filter(p => p.id !== user.id)
  const self = participants.find(p => p.id === user.id)
  const convTitle = others.length === 0
    ? (self?.display_name ?? 'You')
    : others.map(p => p.display_name).join(', ')

  const rawMessages = ((messagesResult.data ?? []) as unknown[]).reverse()

  const parentIds = rawMessages.map((m) => (m as { id: string }).id)
  const { data: replyRows } = parentIds.length
    ? await supabase.from('messages').select('parent_id').in('parent_id', parentIds).is('deleted_at', null)
    : { data: [] }
  const replyCounts: Record<string, number> = {}
  for (const r of (replyRows ?? []) as { parent_id: string }[]) {
    replyCounts[r.parent_id] = (replyCounts[r.parent_id] ?? 0) + 1
  }

  // Enrich forwarded messages
  const forwardedIds = rawMessages
    .map((m) => (m as { forwarded_from: string | null }).forwarded_from)
    .filter(Boolean) as string[]
  const forwardedMap: Record<string, object> = {}
  if (forwardedIds.length > 0) {
    const { data: originals } = await supabase
      .from('messages')
      .select('id, content, room_id, conversation_id, sender:hub_users!sender_id (display_name)')
      .in('id', forwardedIds)
    for (const o of originals ?? []) {
      const orig = o as { id: string; sender: { display_name: string } | { display_name: string }[] | null; [key: string]: unknown }
      const sender = Array.isArray(orig.sender) ? orig.sender[0] : orig.sender
      forwardedMap[orig.id as string] = { ...orig, sender }
    }
  }

  const initialMessages = rawMessages.map((m) => {
    const msg = m as { id: string; forwarded_from: string | null; [key: string]: unknown }
    return {
      ...msg,
      reply_count: replyCounts[msg.id] ?? 0,
      forwarded_original: msg.forwarded_from ? forwardedMap[msg.forwarded_from] ?? null : null,
    }
  })

  return (
    <div className="flex flex-col h-full">
      <DMHeader
        solo={others.length === 1 ? { id: others[0].id } : others.length === 0 && self ? { id: self.id } : null}
        initialEffectiveStatus={
          others.length === 1
            ? others[0].effective_status ?? others[0].status ?? null
            : others.length === 0
              ? self?.effective_status ?? self?.status ?? null
              : null
        }
        initialManualStatus={
          others.length === 1
            ? others[0].status ?? null
            : others.length === 0
              ? self?.status ?? null
              : null
        }
        convTitle={convTitle}
        othersCount={others.length}
      />

      <RoomView
        conversationId={conversationId}
        initialMessages={initialMessages as never}
        currentUserId={user.id}
        hubUsers={(hubUsersResult.data ?? []) as never}
        isAdmin={profileResult.data?.role === 'admin'}
        senderDisplayName={convTitle}
        composerPlaceholder={`Message ${convTitle}`}
        rooms={(allRoomsResult.data ?? []) as { id: string; name: string }[]}
        conversationMembers={participants}
        initialMemberReadReceipts={(receiptsResult.data ?? []) as { user_id: string; last_read_at: string }[]}
      />
    </div>
  )
}
