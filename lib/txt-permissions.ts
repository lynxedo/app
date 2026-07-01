import type { SupabaseClient } from '@supabase/supabase-js'

export type TxtConvRole = 'owner' | 'member' | null

export type TxtConvPermissions = {
  role: TxtConvRole
  isOwner: boolean
  isMember: boolean // any participant: owner or member
  isManager: boolean
  isTxtUser: boolean // any teammate with Txt2 access
  canView: boolean // read the thread: participant OR any Txt2 user (shared "All" inbox)
  canArchive: boolean // owner OR a Txt manager (admin / can_admin_txt / can_assign_txt_threads)
  canUnarchive: boolean // REOPEN an archived thread: any Txt2 teammate (low-stakes + reversible)
  canManageMembers: boolean // add/remove OTHER people: owner OR a Txt manager
  canReply: boolean // SEND a text: owner or added member ONLY
  canJoin: boolean // self-join: any Txt2 user who isn't already a participant
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

  // Any teammate with Txt2 access can READ the shared inbox — open any
  // conversation in the "All" tab and follow along. But SENDING is restricted
  // to the owner + members they were explicitly added to (see `canReply`);
  // a non-participant joins first (one click) before they can text. Manager-
  // only powers (Queue, Responder, Broadcasts) stay gated by `isManager`.
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
    // Read access: any participant OR any Txt2 user (keeps the "All" tab open).
    canView: isMember || isTxtUser,
    // Archiving for everyone is owner-level — only the owner or a Txt manager.
    // (A plain Txt2 teammate viewing the shared inbox must NOT archive someone
    // else's thread.) Admins/managers keep the override.
    canArchive: isOwner || isManager,
    // Reopening (unarchiving) is NOT owner-level. Bringing a thread back into the
    // active inbox is low-stakes + reversible, and it's exactly what a rep needs
    // to re-engage an archived customer. Any Txt2 teammate who can view the shared
    // inbox may reopen — mirrors Join/Claim (they can already reply on any active
    // thread once they claim/join). Only ARCHIVING-for-everyone stays privileged.
    canUnarchive: isTxtUser,
    // Adding/removing OTHER people is privileged — owner of the thread or a
    // Txt manager. (Self-join is handled separately via `canJoin`.)
    canManageMembers: isOwner || isManager,
    // SEND gate: only the owner or an added member. The unassigned-Queue
    // "claim by replying" path is handled at the send call site, not here.
    canReply: isMember,
    // Self-join: any Txt2 user who isn't already on the thread can add
    // themselves so they get a voice without waiting to be added.
    canJoin: isTxtUser && !isMember,
  }
}
