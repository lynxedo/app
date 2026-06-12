import type { SupabaseClient } from '@supabase/supabase-js'

export type TxtConvRole = 'owner' | 'member' | null

export type TxtConvPermissions = {
  role: TxtConvRole
  isOwner: boolean
  isMember: boolean // any participant: owner or member
  isManager: boolean
  isTxtUser: boolean // any teammate with Txt2 access
  canArchive: boolean // owner OR any Txt2 user
  canManageMembers: boolean // owner OR any Txt2 user
  canReply: boolean // member OR any Txt2 user
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
      .select('role, can_admin_txt, can_assign_txt_threads, can_access_txt')
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

  // Any teammate with Txt2 access can work the shared inbox: reply to,
  // reassign, note, AI-draft and archive ANY conversation — not just ones
  // they own or are a member of. Manager-only powers (Queue, Responder,
  // Broadcasts) stay gated by `isManager`.
  const isTxtUser = isManager || profile?.can_access_txt === true

  const role = (membership?.role as TxtConvRole) || null
  const isOwner = role === 'owner'
  const isMember = role !== null

  return {
    role,
    isOwner,
    isMember,
    isManager,
    isTxtUser,
    canArchive: isOwner || isTxtUser,
    canManageMembers: isOwner || isTxtUser,
    canReply: isMember || isTxtUser,
  }
}
