import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function ensureSelfConversation(userId: string) {
  const admin = createAdminClient()
  // Find any single-member conversation where the only member is this user.
  // Prefer the oldest one if there are duplicates (most likely to be the
  // canonical / Slack-imported one).
  const { data: mine } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)
  const myIds = (mine ?? []).map((m: { conversation_id: string }) => m.conversation_id)
  if (myIds.length > 0) {
    const { data: peers } = await admin
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', myIds)
    const counts: Record<string, number> = {}
    for (const p of (peers ?? []) as { conversation_id: string; user_id: string }[]) {
      counts[p.conversation_id] = (counts[p.conversation_id] ?? 0) + 1
    }
    const candidates = myIds.filter(cid => counts[cid] === 1)
    if (candidates.length > 0) {
      const { data: ordered } = await admin
        .from('conversations')
        .select('id, created_at')
        .in('id', candidates)
        .order('created_at', { ascending: true })
        .limit(1)
      const winner = ordered?.[0]?.id ?? candidates[0]
      // Always unarchive — a self-DM is your scratchpad; if you've ever
      // archived it, surface it again the next time you open Hub.
      await admin
        .from('conversation_members')
        .update({ archived_at: null })
        .eq('conversation_id', winner)
        .eq('user_id', userId)
      return winner
    }
  }
  // Create one
  const { data: profile } = await admin
    .from('user_profiles')
    .select('company_id')
    .eq('id', userId)
    .single()
  if (!profile?.company_id) return null
  const { data: conv, error } = await admin
    .from('conversations')
    .insert({ company_id: profile.company_id })
    .select('id')
    .single()
  if (error || !conv) return null
  await admin
    .from('conversation_members')
    .insert({ conversation_id: conv.id, user_id: userId })
  return conv.id
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ensure the user's self-DM exists (idempotent — finds or creates a
  // single-member conversation owned by this user, used as a personal
  // scratchpad / saved-messages spot in the sidebar).
  await ensureSelfConversation(user.id)

  // Get conversation IDs + my archived_at for each
  const { data: memberships } = await supabase
    .from('conversation_members')
    .select('conversation_id, archived_at')
    .eq('user_id', user.id)

  if (!memberships?.length) return NextResponse.json({ conversations: [] })

  const myArchived: Record<string, string | null> = {}
  for (const m of memberships as { conversation_id: string; archived_at: string | null }[]) {
    myArchived[m.conversation_id] = m.archived_at
  }
  const convIds = memberships.map((m: { conversation_id: string }) => m.conversation_id)

  // Use admin client to read all members (bypasses RLS which only shows own rows)
  const admin = createAdminClient()
  const { data: members } = await admin
    .from('conversation_members')
    .select('conversation_id, user_id, hub_users!user_id(id, display_name, avatar_url)')
    .in('conversation_id', convIds)

  // Get most recent message per conversation — DISTINCT ON via RPC so we
  // pull one row per conv instead of every message in every DM (Heroes' top
  // DM has 21k+ messages, this used to load all of them).
  const { data: recentMsgs } = await admin
    .rpc('get_last_top_level_message_per_conversation', { conv_ids: convIds })

  // Build conversation objects
  type HubUser = { id: string; display_name: string; avatar_url: string | null }
  type ConvMap = { id: string; participants: HubUser[]; last_message?: string; last_at?: string; archived_at: string | null; archived: boolean }
  const convsMap: Record<string, ConvMap> = {}

  for (const m of members ?? []) {
    const cm = m as unknown as { conversation_id: string; user_id: string; hub_users: HubUser | HubUser[] }
    if (!convsMap[cm.conversation_id]) {
      convsMap[cm.conversation_id] = {
        id: cm.conversation_id,
        participants: [],
        archived_at: myArchived[cm.conversation_id] ?? null,
        archived: false,
      }
    }
    const hu = Array.isArray(cm.hub_users) ? cm.hub_users[0] : cm.hub_users
    if (hu) convsMap[cm.conversation_id].participants.push(hu)
  }

  // Attach last message (first result per conv since ordered desc)
  const seen = new Set<string>()
  for (const msg of recentMsgs ?? []) {
    const m = msg as { conversation_id: string; content: string; created_at: string }
    if (!seen.has(m.conversation_id) && convsMap[m.conversation_id]) {
      convsMap[m.conversation_id].last_message = m.content
      convsMap[m.conversation_id].last_at = m.created_at
      seen.add(m.conversation_id)
    }
  }

  // Compute archived: manually archived OR auto-archived (last message > 60 days old).
  // A DM with no messages yet (just created) is treated as active.
  const sixtyDaysAgoMs = Date.now() - 60 * 24 * 60 * 60 * 1000
  for (const c of Object.values(convsMap)) {
    const autoArchived = c.last_at ? new Date(c.last_at).getTime() < sixtyDaysAgoMs : false
    c.archived = c.archived_at != null || autoArchived
  }

  const conversations = Object.values(convsMap)
    .filter(c => c.participants.length > 0)
    .sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''))

  return NextResponse.json({ conversations })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { participant_ids } = await request.json()
  if (!Array.isArray(participant_ids)) {
    return NextResponse.json({ error: 'participant_ids required' }, { status: 400 })
  }

  // Empty participant_ids (or one containing only the caller) means "self DM".
  const allParticipants = [...new Set<string>([user.id, ...participant_ids])]

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Check if a conversation with this exact set of participants already exists.
  // Single batched query for all members of all my conversations, then group
  // and compare in JS — used to do one round-trip per conversation.
  {
    const { data: myMemberships } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id)

    const myConvIds = (myMemberships ?? []).map((m: { conversation_id: string }) => m.conversation_id)
    if (myConvIds.length > 0) {
      const admin = createAdminClient()
      const { data: allMembers } = await admin
        .from('conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', myConvIds)

      const membersByConv: Record<string, string[]> = {}
      for (const m of (allMembers ?? []) as { conversation_id: string; user_id: string }[]) {
        if (!membersByConv[m.conversation_id]) membersByConv[m.conversation_id] = []
        membersByConv[m.conversation_id].push(m.user_id)
      }

      const target = [...allParticipants].sort()
      for (const [convId, userIds] of Object.entries(membersByConv)) {
        const ids = [...userIds].sort()
        if (ids.length === target.length && ids.every((id, i) => id === target[i])) {
          // Starting a new DM with this person — unarchive for the caller
          await supabase
            .from('conversation_members')
            .update({ archived_at: null })
            .eq('conversation_id', convId)
            .eq('user_id', user.id)
          return NextResponse.json({ id: convId, existing: true })
        }
      }
    }
  }

  // Create new conversation — use admin client so the post-insert SELECT
  // isn't blocked by the conversations_select RLS (which requires membership
  // that doesn't exist yet at insert time).
  const adminForInsert = createAdminClient()
  const { data: conv, error } = await adminForInsert
    .from('conversations')
    .insert({ company_id: profile.company_id })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await adminForInsert
    .from('conversation_members')
    .insert(allParticipants.map(uid => ({ conversation_id: conv.id, user_id: uid })))

  return NextResponse.json({ id: conv.id }, { status: 201 })
}
