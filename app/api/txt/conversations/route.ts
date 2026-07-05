import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMessagePreview } from '@/lib/txt-preview'
import { getAccessibleNumberIds } from '@/lib/phone-number-access'
import { fetchAllRows } from '@/lib/email-contacts'
import { ilikeSearchPattern } from '@/lib/search'

// ── Unified Inbox (Session 3): cross-channel last-activity enrichment ───────
// When the caller can_access_unified_inbox, each conversation row is decorated
// with its contact's most-recent call + voicemail so the left rail can sort by
// GREATEST(last text, last call, last voicemail), show a last-activity-type
// icon, and filter on Missed / Voicemails. Read-only; calls/voicemails are read
// via the admin client + an explicit company_id filter, exactly as the dialer
// recording route does (those tables are service-role-scoped, not user-RLS).
// Flag off → this never runs and the list is texts-only, unchanged.

type ConvRow = {
  id: string
  last_message_at: string | null
  last_inbound_at: string | null
  created_at: string
  contact?: { id?: string } | { id?: string }[] | null
  [k: string]: unknown
}

const MISSED_STATUSES = new Set(['no-answer', 'voicemail'])

function contactIdOf(c: ConvRow): string | null {
  const inner = Array.isArray(c.contact) ? c.contact[0] : c.contact
  return inner?.id ?? null
}

/** Latest of a set of ISO timestamps (nulls ignored). Returns null if all null. */
function latestIso(...vals: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestT = -Infinity
  for (const v of vals) {
    if (!v) continue
    const t = Date.parse(v)
    if (Number.isFinite(t) && t > bestT) {
      bestT = t
      best = v
    }
  }
  return best
}

async function enrichWithCallActivity(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  convs: ConvRow[]
): Promise<ConvRow[]> {
  if (convs.length === 0 || !companyId) return convs
  const contactIds = Array.from(
    new Set(convs.map(contactIdOf).filter((x): x is string => !!x))
  )
  if (contactIds.length === 0) return convs

  type Agg = {
    lastCallAt: string | null
    lastVmAt: string | null
    lastMissedAt: string | null
    hasMissed: boolean
    hasVm: boolean
    hasUnheardVm: boolean
  }
  const byContact = new Map<string, Agg>()
  const get = (id: string): Agg => {
    let a = byContact.get(id)
    if (!a) {
      a = { lastCallAt: null, lastVmAt: null, lastMissedAt: null, hasMissed: false, hasVm: false, hasUnheardVm: false }
      byContact.set(id, a)
    }
    return a
  }

  // Chunk the .in() list (hundreds of UUIDs overflow the PostgREST GET URL) and
  // page each chunk — a single response caps at 1,000 rows regardless of
  // .limit(), which silently dropped missed-call/VM indicators on older
  // conversations. The id tiebreak keeps pages non-overlapping on created_at ties.
  type CallRow = { contact_id: string | null; created_at: string; direction: string | null; status: string | null }
  type VmRow = { contact_id: string | null; created_at: string; heard_at: string | null }
  const callRows: CallRow[] = []
  const vmRows: VmRow[] = []
  const CHUNK = 100
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const part = contactIds.slice(i, i + CHUNK)
    const [calls, vms] = await Promise.all([
      fetchAllRows<CallRow>(() => admin
        .from('calls')
        .select('contact_id, created_at, direction, status')
        .eq('company_id', companyId)
        .in('contact_id', part)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })),
      fetchAllRows<VmRow>(() => admin
        .from('voicemails')
        .select('contact_id, created_at, heard_at')
        .eq('company_id', companyId)
        .in('contact_id', part)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })),
    ])
    callRows.push(...calls)
    vmRows.push(...vms)
  }

  // Rows arrive newest-first, so the first row seen for a contact is the latest.
  for (const row of callRows) {
    if (!row.contact_id) continue
    const a = get(row.contact_id)
    if (!a.lastCallAt) a.lastCallAt = row.created_at
    const missed = row.direction === 'inbound' && !!row.status && MISSED_STATUSES.has(row.status)
    if (missed) {
      a.hasMissed = true
      if (!a.lastMissedAt) a.lastMissedAt = row.created_at
    }
  }
  for (const row of vmRows) {
    if (!row.contact_id) continue
    const a = get(row.contact_id)
    if (!a.lastVmAt) a.lastVmAt = row.created_at
    a.hasVm = true
    if (!row.heard_at) a.hasUnheardVm = true
  }

  const enriched = convs.map((c) => {
    const cid = contactIdOf(c)
    const a = cid ? byContact.get(cid) : undefined
    const base = c.last_message_at ?? c.created_at ?? null
    const lastCallAt = a?.lastCallAt ?? null
    const lastVmAt = a?.lastVmAt ?? null
    const lastActivityAt = latestIso(base, lastCallAt, lastVmAt) ?? base
    // Type of the newest activity. Voicemail/call only win when strictly newer
    // than the last text; ties resolve to text (the conversation's spine).
    let lastActivityType: 'text' | 'call' | 'voicemail' = 'text'
    if (lastActivityAt && lastActivityAt === lastVmAt && lastActivityAt !== base) {
      lastActivityType = 'voicemail'
    } else if (lastActivityAt && lastActivityAt === lastCallAt && lastActivityAt !== base) {
      lastActivityType = 'call'
    }
    return {
      ...c,
      last_call_at: lastCallAt,
      last_voicemail_at: lastVmAt,
      last_activity_at: lastActivityAt,
      last_activity_type: lastActivityType,
      has_missed_call: !!a?.hasMissed,
      has_voicemail: !!a?.hasVm,
      has_unheard_voicemail: !!a?.hasUnheardVm,
      // Folds missed calls + voicemails into the unread signal so the rail's
      // existing per-device "reads" dot lights for any unhandled inbound.
      last_inbound_activity_at: latestIso(c.last_inbound_at, lastVmAt, a?.lastMissedAt),
    }
  })

  // Re-sort by most-recent activity of ANY channel (the unified-inbox sort).
  enriched.sort((x, y) => {
    const tx = x.last_activity_at ? Date.parse(x.last_activity_at as string) : -Infinity
    const ty = y.last_activity_at ? Date.parse(y.last_activity_at as string) : -Infinity
    return ty - tx
  })
  return enriched
}

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
    .select('role, can_admin_txt, can_assign_txt_threads, can_access_txt, can_access_unified_inbox, company_id')
    .eq('id', user.id)
    .single()
  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true
  const isTxtUser = isManager || profile?.can_access_txt === true
  // Unified inbox is a read-all lens: admin OR the per-user flag. Gates the
  // cross-channel activity enrichment only — send/call paths gate separately.
  const canAccessUnifiedInbox =
    profile?.role === 'admin' || profile?.can_access_unified_inbox === true
  const companyId = profile?.company_id || ''

  // Per-user number scope (declutters a tech's view to the line(s) they work).
  // Managers/admins always see all numbers; plain Txt2 users are limited to the
  // numbers granted in user_phone_number_access (null = unrestricted). Untagged
  // conversations (phone_number_id IS NULL) stay visible to everyone.
  const numberScope = isManager
    ? null
    : await getAccessibleNumberIds(createAdminClient(), user.id)
  // PostgREST `.or()` fragment restricting to the granted numbers OR untagged.
  const numberScopeOr = numberScope
    ? `phone_number_id.in.(${numberScope.join(',')}),phone_number_id.is.null`
    : null

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

    const pattern = ilikeSearchPattern(q)
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

    let foundQuery = supabase
      .from('txt_conversations')
      .select(
        `id, kind, status, source, assigned_to, archived_by, phone_number_id, last_message_at, last_inbound_at, last_message_preview, last_message_direction, created_at,
         contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, phone, do_not_text ),
         assignee:hub_users!assigned_to ( id, display_name ),
         members:txt_conversation_members ( user_id, role, member:hub_users!user_id ( id, display_name ) ),
         group_contacts:txt_conversation_contacts ( contact:txt_contacts!txt_conversation_contacts_contact_id_fkey ( id, name, phone ) ),
         number:txt_phone_numbers!txt_conversations_phone_number_id_fkey ( label, twilio_number )`
      )
      .in('id', allIds)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(50)
    if (numberScopeOr) foundQuery = foundQuery.or(numberScopeOr)
    const { data: found, error: foundErr } = await foundQuery
    if (foundErr) return NextResponse.json({ error: foundErr.message }, { status: 500 })
    const foundRows = (found ?? []) as unknown as ConvRow[]
    const out = canAccessUnifiedInbox
      ? await enrichWithCallActivity(createAdminClient(), companyId, foundRows)
      : foundRows
    return NextResponse.json({ conversations: out })
  }

  let query = supabase
    .from('txt_conversations')
    .select(
      `id, kind, status, source, assigned_to, archived_by, phone_number_id, last_message_at, last_inbound_at, last_message_preview, last_message_direction, created_at,
       contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, phone, do_not_text ),
       assignee:hub_users!assigned_to ( id, display_name ),
       members:txt_conversation_members ( user_id, role, member:hub_users!user_id ( id, display_name ) ),
       group_contacts:txt_conversation_contacts ( contact:txt_contacts!txt_conversation_contacts_contact_id_fkey ( id, name, phone ) ),
       number:txt_phone_numbers!txt_conversations_phone_number_id_fkey ( label, twilio_number )`
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
    // The unassigned Queue is the unified triage queue. Unified Inbox Session 6:
    // Guardian/Responder threads (source='responder') now fold INTO this Queue
    // as unclaimed items (surfaced with a "Guardian replied" badge in the rail)
    // instead of living in a separate Responder tab. So no source exclusion.
    query = query.eq('status', 'unassigned')
  } else if (scope === 'archived') {
    query = query.eq('status', 'archived')
    if (!isTxtUser) {
      query = query.eq('archived_by', user.id)
    }
    if (numberScopeOr) query = query.or(numberScopeOr)
  } else if (scope === 'all') {
    query = query.neq('status', 'archived')
    if (numberScopeOr) query = query.or(numberScopeOr)
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

  const out = canAccessUnifiedInbox
    ? await enrichWithCallActivity(createAdminClient(), companyId, results as unknown as ConvRow[])
    : results
  return NextResponse.json({ conversations: out })
}
