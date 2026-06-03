import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/txt/conversations
// Query: scope=mine|unassigned|all|archived, search?, limit?
//
// `mine` returns conversations the user owns OR is a member of (via
// txt_conversation_members). The legacy assigned_to column is the cached
// owner pointer; the members table is the source of truth for membership.
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

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_hub, can_assign_txt_threads')
    .eq('id', user.id)
    .single()
  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_hub === true ||
    profile?.can_assign_txt_threads === true

  if (!isManager && (scope === 'unassigned' || scope === 'all')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let query = supabase
    .from('txt_conversations')
    .select(
      `id, kind, status, assigned_to, archived_by, last_message_at, last_inbound_at, last_message_preview, last_message_direction, created_at,
       contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, phone, do_not_text ),
       assignee:hub_users!assigned_to ( id, display_name ),
       members:txt_conversation_members ( user_id, role, member:hub_users!user_id ( id, display_name ) ),
       group_contacts:txt_conversation_contacts ( contact:txt_contacts!txt_conversation_contacts_contact_id_fkey ( id, name, phone ) )`
    )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (scope === 'mine') {
    // Owned OR member-of. Subquery against members table.
    const { data: myConvIds } = await supabase
      .from('txt_conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id)
    const ids = (myConvIds ?? []).map((r) => r.conversation_id)
    if (ids.length === 0) {
      return NextResponse.json({ conversations: [] })
    }
    query = query.in('id', ids).neq('status', 'archived')
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
      if (
        contact?.name?.toLowerCase().includes(needle) ||
        contact?.phone?.toLowerCase().includes(needle)
      ) {
        return true
      }
      // Group conversations: match if any participant matches.
      const groupContacts = Array.isArray(c.group_contacts) ? c.group_contacts : []
      return groupContacts.some((gc) => {
        const inner = Array.isArray(gc.contact) ? gc.contact[0] : gc.contact
        return (
          inner?.name?.toLowerCase().includes(needle) ||
          inner?.phone?.toLowerCase().includes(needle)
        )
      })
    })
  }

  return NextResponse.json({ conversations: results })
}
