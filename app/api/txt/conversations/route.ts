import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildMessagePreview } from '@/lib/txt-preview'

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
    .select('role, can_admin_txt, can_assign_txt_threads, can_access_txt')
    .eq('id', user.id)
    .single()
  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true
  const isTxtUser = isManager || profile?.can_access_txt === true

  // The shared "All" inbox is visible to every Txt2 user. The unassigned
  // Queue and the Responder tab stay manager-only.
  if ((scope === 'unassigned' || scope === 'responder') && !isManager) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (scope === 'all' && !isTxtUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Server-side search across contacts (name/phone) AND message bodies.
  // Returns up to 50 matching conversations; the sidebar shows them in a
  // dedicated search-results mode (bypasses scope/queue filtering).
  if (scope === 'search') {
    if (!isTxtUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const q = (url.searchParams.get('q') || '').trim()
    if (q.length < 2) return NextResponse.json({ conversations: [] })

    const pattern = `%${q}%`
    const [contactsRes, msgsRes] = await Promise.all([
      supabase
        .from('txt_contacts')
        .select('id')
        .or(`name.ilike.${pattern},phone.ilike.${pattern}`)
        .limit(100),
      supabase
        .from('txt_messages')
        .select('conversation_id')
        .ilike('body', pattern)
        .limit(300),
    ])

    // Conversations where the primary contact matches.
    let convIdsFromContacts: string[] = []
    const contactIds = (contactsRes.data ?? []).map((c) => c.id)
    if (contactIds.length > 0) {
      const { data: convRows } = await supabase
        .from('txt_conversations')
        .select('id')
        .in('contact_id', contactIds)
      convIdsFromContacts = (convRows ?? []).map((r) => r.id)
    }

    const allIds = Array.from(
      new Set([
        ...convIdsFromContacts,
        ...(msgsRes.data ?? []).map((m) => m.conversation_id),
      ])
    )
    if (allIds.length === 0) return NextResponse.json({ conversations: [] })

    const { data: found, error: foundErr } = await supabase
      .from('txt_conversations')
      .select(
        `id, kind, status, source, assigned_to, archived_by, last_message_at, last_inbound_at, last_message_preview, last_message_direction, created_at,
         contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, phone, do_not_text ),
         assignee:hub_users!assigned_to ( id, display_name ),
         members:txt_conversation_members ( user_id, role, member:hub_users!user_id ( id, display_name ) ),
         group_contacts:txt_conversation_contacts ( contact:txt_contacts!txt_conversation_contacts_contact_id_fkey ( id, name, phone ) )`
      )
      .in('id', allIds)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(50)
    if (foundErr) return NextResponse.json({ error: foundErr.message }, { status: 500 })
    return NextResponse.json({ conversations: found ?? [] })
  }

  let query = supabase
    .from('txt_conversations')
    .select(
      `id, kind, status, source, assigned_to, archived_by, last_message_at, last_inbound_at, last_message_preview, last_message_direction, created_at,
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
    // The unassigned Queue is the HUMAN triage queue. Guardian/Responder
    // conversations live in their own Responder tab (source='responder'), so
    // keep unclaimed Guardian threads out of the human queue. (null-safe: keep
    // rows with no source set.)
    query = query.eq('status', 'unassigned').or('source.is.null,source.neq.responder')
  } else if (scope === 'archived') {
    query = query.eq('status', 'archived')
    if (!isTxtUser) {
      query = query.eq('archived_by', user.id)
    }
  } else if (scope === 'all') {
    query = query.neq('status', 'archived')
  } else if (scope === 'responder') {
    query = query.eq('source', 'responder').neq('status', 'archived')
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

  // Authoritative sidebar preview: recompute from the newest message per
  // conversation (txt_latest_messages). The denormalized last_message_preview
  // column can be stale on staging because inbound SMS hits the prod webhook,
  // whose main-branch code doesn't maintain that column. Reading the live
  // message is always correct on both branches.
  const ids = results.map((c) => c.id)
  if (ids.length > 0) {
    const { data: latest } = await supabase.rpc('txt_latest_messages', { conv_ids: ids })
    if (Array.isArray(latest) && latest.length > 0) {
      const byId = new Map<
        string,
        { body: string | null; media_count: number; direction: string }
      >()
      for (const row of latest) {
        byId.set(row.conversation_id, {
          body: row.body ?? null,
          media_count: row.media_count ?? 0,
          direction: row.direction,
        })
      }
      results = results.map((c) => {
        const lm = byId.get(c.id)
        return lm
          ? {
              ...c,
              last_message_preview: buildMessagePreview(lm.body, lm.media_count),
              last_message_direction: lm.direction,
            }
          : c
      })
    }
  }

  return NextResponse.json({ conversations: results })
}
