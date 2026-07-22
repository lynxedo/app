// Shared-inbox permission tiers (mirrors lib/txt-permissions.ts).
// Two roles (PRD Redesign 2026-07-22):
//   • Manager  = admin OR can_manage_shared_inbox — sees All + the unassigned Queue; can claim/assign/close/share.
//   • Standard = can_access_shared_inbox (only) — may open the inbox; sees ONLY threads assigned/shared to them
//                (enforced in DB by RLS; re-checked here).
// The DB RLS "sees-everything" clause keys off can_manage_shared_inbox, so a Standard user is naturally
// restricted to their assignee/member threads.

import type { SupabaseClient } from '@supabase/supabase-js'

export type InboxUserFlags = {
  role: string
  isManager: boolean // admin OR can_manage_shared_inbox — All + Queue, RLS sees everything
  hasAccess: boolean // isManager OR can_access_shared_inbox — may enter the shared inbox (own threads)
  canCompose: boolean // may start a NEW outbound as the shared mailbox
  /** @deprecated alias for isManager, kept so existing call sites (getInboxThreadPermissions) compile. */
  isFullAccess: boolean
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
    .select('role, can_manage_shared_inbox, can_access_shared_inbox, can_compose_shared_email')
    .eq('id', userId)
    .maybeSingle()
  const role = (data?.role as string) || 'user'
  const isManager = role === 'admin' || !!data?.can_manage_shared_inbox
  const hasAccess = isManager || !!data?.can_access_shared_inbox
  const canCompose = hasAccess || !!data?.can_compose_shared_email
  return { role, isManager, hasAccess, canCompose, isFullAccess: isManager }
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
