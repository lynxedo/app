import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/txt/unread → { latest_inbound_at: string | null }
//
// The newest customer inbound timestamp across the Txt2 conversations this user
// can see (managers: all non-archived in their company; everyone else: the
// threads they own or are a member of). The Hub rail compares this against a
// per-device "last opened Txt2" timestamp to decide whether to light the dot —
// same shape as the Daily Log unread signal, no server-side read receipt needed.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_hub, can_assign_txt_threads, can_access_txt')
    .eq('id', user.id)
    .single()

  // Not a Txt2 user → nothing to report (the rail won't even call this, but
  // guard anyway so the dot can never light for someone without access).
  if (profile?.role !== 'admin' && !profile?.can_access_txt) {
    return NextResponse.json({ latest_inbound_at: null })
  }

  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_hub === true ||
    profile?.can_assign_txt_threads === true

  let query = supabase
    .from('txt_conversations')
    .select('last_inbound_at')
    .neq('status', 'archived')
    .not('last_inbound_at', 'is', null)
    .order('last_inbound_at', { ascending: false })
    .limit(1)

  // Non-managers only see threads they're a member of (mirrors the
  // conversations list route's `mine` scope). Company scoping is handled by RLS.
  if (!isManager) {
    const { data: myConvIds } = await supabase
      .from('txt_conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id)
    const ids = (myConvIds ?? []).map((r) => r.conversation_id)
    if (ids.length === 0) return NextResponse.json({ latest_inbound_at: null })
    query = query.in('id', ids)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ latest_inbound_at: null })
  return NextResponse.json({ latest_inbound_at: data?.[0]?.last_inbound_at ?? null })
}
