import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/txt/conversations
// Query: scope=mine|unassigned|all|archived, search?, limit?
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const scope = (url.searchParams.get('scope') || 'mine').toLowerCase()
  const search = url.searchParams.get('search') || ''
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500)

  // Manager status decides whether Archived shows everyone's archived threads
  // or just the caller's own. Mirrors the gating in the archive + assign routes.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_hub, can_assign_txt_threads')
    .eq('id', user.id)
    .single()
  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_hub === true ||
    profile?.can_assign_txt_threads === true

  // Reject scopes a non-manager can't see at all. Sidebar already hides these tabs,
  // but enforce at the API level so a hand-crafted request can't peek into the queue.
  if (!isManager && (scope === 'unassigned' || scope === 'all')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Base select — we'll filter and order in the query
  let query = supabase
    .from('txt_conversations')
    .select(
      `id, status, assigned_to, archived_by, last_message_at, last_inbound_at, created_at,
       contact:txt_contacts ( id, name, phone, do_not_text ),
       assignee:hub_users!assigned_to ( id, display_name )`
    )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (scope === 'mine') {
    query = query.eq('assigned_to', user.id).neq('status', 'archived')
  } else if (scope === 'unassigned') {
    query = query.eq('status', 'unassigned')
  } else if (scope === 'archived') {
    query = query.eq('status', 'archived')
    if (!isManager) {
      query = query.eq('archived_by', user.id)
    }
  } else if (scope === 'all') {
    query = query.neq('status', 'archived')
  } else {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let results = data ?? []
  if (search) {
    const needle = search.toLowerCase()
    results = results.filter((c) => {
      const contact = Array.isArray(c.contact) ? c.contact[0] : c.contact
      return (
        contact?.name?.toLowerCase().includes(needle) ||
        contact?.phone?.toLowerCase().includes(needle)
      )
    })
  }

  return NextResponse.json({ conversations: results })
}
