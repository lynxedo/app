import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/txt/unread → { latest_inbound_at: string | null }
//
// The newest customer inbound timestamp across the Txt2 conversations this user
// should be alerted about: threads they own or are a member of, plus — for
// managers — the unassigned Queue. A thread claimed by someone else does NOT
// light another user's dot. The Hub rail compares this against a per-device
// "last opened Txt2" timestamp to decide whether to light the dot — same shape
// as the Daily Log unread signal, no server-side read receipt needed.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_txt, can_assign_txt_threads, can_access_txt')
    .eq('id', user.id)
    .single()

  // Not a Txt2 user → nothing to report (the rail won't even call this, but
  // guard anyway so the dot can never light for someone without access).
  if (profile?.role !== 'admin' && !profile?.can_access_txt) {
    return NextResponse.json({ latest_inbound_at: null })
  }

  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true

  // Threads this user owns or is a member of. The /assign route writes the owner
  // into txt_conversation_members as role='owner', so this single lookup is the
  // authoritative "owner + members" set — exactly who an active thread alerts.
  const { data: myConvRows } = await supabase
    .from('txt_conversation_members')
    .select('conversation_id')
    .eq('user_id', user.id)
  const myIds = (myConvRows ?? []).map((r) => r.conversation_id)

  let query = supabase
    .from('txt_conversations')
    .select('last_inbound_at')
    .neq('status', 'archived')
    .not('last_inbound_at', 'is', null)
    .order('last_inbound_at', { ascending: false })
    .limit(1)

  if (isManager) {
    // Managers light the dot for the unassigned Queue (anyone can pick those up)
    // plus the threads they're personally on. Once a thread is claimed by
    // someone else it drops off the manager's radar — only its owner + members
    // get the dot. Company scoping is handled by RLS.
    const orParts = ['status.eq.unassigned']
    if (myIds.length > 0) orParts.push(`id.in.(${myIds.join(',')})`)
    query = query.or(orParts.join(','))
  } else {
    // Non-managers only see threads they're a member of (mirrors the
    // conversations list route's `mine` scope).
    if (myIds.length === 0) return NextResponse.json({ latest_inbound_at: null })
    query = query.in('id', myIds)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ latest_inbound_at: null })
  return NextResponse.json({ latest_inbound_at: data?.[0]?.last_inbound_at ?? null })
}
