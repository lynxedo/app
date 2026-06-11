import type { SupabaseClient } from '@supabase/supabase-js'

export type TxtConvRole = 'owner' | 'member' | null

export type TxtConvPermissions = {
  role: TxtConvRole
  isOwner: boolean
  isMember: boolean // any participant: owner or member
  isManager: boolean
  canArchive: boolean // owner OR manager
  canManageMembers: boolean // owner OR manager
  canReply: boolean // owner, member, or manager
}

// Loads the caller's role on a conversation + whether they're a Txt
// manager. Inlines what most routes used to do ad-hoc; pulled out so
// new routes (members add/remove, group send, archive) stay consistent.
export async function getTxtConvPermissions(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<TxtConvPermissions> {
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('role, can_admin_txt, can_assign_txt_threads')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('txt_conversation_members')
      .select('role')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true

  const role = (membership?.role as TxtConvRole) || null
  const isOwner = role === 'owner'
  const isMember = role !== null

  return {
    role,
    isOwner,
    isMember,
    isManager,
    canArchive: isOwner || isManager,
    canManageMembers: isOwner || isManager,
    canReply: isMember || isManager,
  }
}
