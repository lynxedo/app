// Shared-inbox permission tiers (mirrors lib/txt-permissions.ts).
// Full access = admin OR can_access_shared_inbox (managers/office see the whole shared queue).
// Thread-scoped = techs who were shared / assigned a specific thread (enforced in DB by RLS; re-checked here).

import type { SupabaseClient } from '@supabase/supabase-js'

export type InboxUserFlags = {
  role: string
  isFullAccess: boolean
  canCompose: boolean // may start a NEW outbound as the shared mailbox
}

export type InboxThreadPermissions = InboxUserFlags & {
  exists: boolean
  isShared: boolean
  isMember: boolean // has an inbox_thread_members row
  isOwner: boolean // that member row is role 'owner' (claimed/assigned)
  isAssignee: boolean // cached assigned_to pointer
  isPersonalOwner: boolean // personal thread they own
  canView: boolean
  canReply: boolean
  canClaim: boolean // claim an unassigned shared thread for self
  canAssign: boolean // assign/reassign to others (full access only)
  canClose: boolean
  canShare: boolean // share a thread to a technician (full access only)
  canManageMembers: boolean
  canNote: boolean // leave an internal note (full access only)
}

export async function getInboxUserFlags(supabase: SupabaseClient, userId: string): Promise<InboxUserFlags> {
  const { data } = await supabase
    .from('user_profiles')
    .select('role, can_access_shared_inbox, can_compose_shared_email')
    .eq('id', userId)
    .maybeSingle()
  const role = (data?.role as string) || 'user'
  const isFullAccess = role === 'admin' || !!data?.can_access_shared_inbox
  return { role, isFullAccess, canCompose: isFullAccess || !!data?.can_compose_shared_email }
}

export async function getInboxThreadPermissions(
  supabase: SupabaseClient,
  threadId: string,
  userId: string
): Promise<InboxThreadPermissions> {
  const [flags, threadRes, memberRes] = await Promise.all([
    getInboxUserFlags(supabase, userId),
    supabase
      .from('inbox_threads')
      .select('id, is_shared, owner_user_id, assigned_to_user_id, status')
      .eq('id', threadId)
      .maybeSingle(),
    supabase.from('inbox_thread_members').select('role').eq('thread_id', threadId).eq('user_id', userId).maybeSingle(),
  ])

  const thread = threadRes.data as
    | { is_shared: boolean; owner_user_id: string | null; assigned_to_user_id: string | null; status: string }
    | null
  const base: InboxThreadPermissions = {
    ...flags,
    exists: !!thread,
    isShared: !!thread?.is_shared,
    isMember: !!memberRes.data,
    isOwner: memberRes.data?.role === 'owner',
    isAssignee: !!thread && thread.assigned_to_user_id === userId,
    isPersonalOwner: !!thread && thread.is_shared === false && thread.owner_user_id === userId,
    canView: false,
    canReply: false,
    canClaim: false,
    canAssign: false,
    canClose: false,
    canShare: false,
    canManageMembers: false,
    canNote: false,
  }
  if (!thread) return base

  if (!thread.is_shared) {
    // Personal thread: only its owner, no queue mechanics.
    const own = thread.owner_user_id === userId
    return {
      ...base,
      canView: own,
      canReply: own,
      canClose: own,
    }
  }

  // Shared thread.
  const canView = flags.isFullAccess || base.isAssignee || base.isMember
  const closed = thread.status === 'closed'
  return {
    ...base,
    canView,
    canReply: canView,
    canClaim: flags.isFullAccess && !closed && !base.isAssignee,
    canAssign: flags.isFullAccess,
    canClose: canView,
    canShare: flags.isFullAccess,
    canManageMembers: flags.isFullAccess,
    canNote: flags.isFullAccess,
  }
}
