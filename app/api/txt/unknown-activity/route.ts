import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'

type UnknownCallRow = {
  id: string
  direction: 'inbound' | 'outbound' | string | null
  from_number: string | null
  to_number: string | null
  status: string | null
  created_at: string
  duration_seconds: number | null
}

type UnknownVoicemailRow = {
  id: string
  from_number: string | null
  created_at: string
  recording_duration_sec: number | null
  transcript: string | null
  summary: string | null
}

type ContactRow = {
  id: string
  name: string
  phone: string
}

function digits(raw: string | null | undefined) {
  return (raw || '').replace(/\D/g, '')
}

function last10(raw: string | null | undefined) {
  const d = digits(raw)
  return d.length >= 10 ? d.slice(-10) : ''
}

function activityPhone(row: UnknownCallRow) {
  return row.direction === 'inbound'
    ? row.from_number || row.to_number || ''
    : row.to_number || row.from_number || ''
}

async function requireUnifiedInboxAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_access_txt, can_access_unified_inbox')
    .eq('id', user.id)
    .maybeSingle()

  const canRead =
    profile?.can_access_txt === true &&
    (profile?.role === 'admin' || profile?.can_access_unified_inbox === true)

  if (!profile?.company_id || !canRead) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { userId: user.id, companyId: profile.company_id as string }
}

async function loadUnknownRows(companyId: string) {
  const admin = createAdminClient()
  const [callsRes, voicemailsRes, contactsRes] = await Promise.all([
    admin
      .from('calls')
      .select('id, direction, from_number, to_number, status, created_at, duration_seconds')
      .eq('company_id', companyId)
      .is('contact_id', null)
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('voicemails')
      .select('id, from_number, created_at, recording_duration_sec, transcript, summary')
      .eq('company_id', companyId)
      .is('contact_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('txt_contacts')
      .select('id, name, phone')
      .eq('company_id', companyId)
      .limit(1000),
  ])

  if (callsRes.error) throw callsRes.error
  if (voicemailsRes.error) throw voicemailsRes.error
  if (contactsRes.error) throw contactsRes.error

  return {
    calls: (callsRes.data ?? []) as UnknownCallRow[],
    voicemails: (voicemailsRes.data ?? []) as UnknownVoicemailRow[],
    contacts: (contactsRes.data ?? []) as ContactRow[],
  }
}

// GET /api/txt/unknown-activity
// Lists unlinked calls/voicemails grouped by phone number. Hidden unless the
// caller has the Unified Inbox flag; this is the "unknown thread" source for
// Session 4.
export async function GET() {
  const access = await requireUnifiedInboxAccess()
  if ('error' in access) return access.error

  try {
    const { calls, voicemails, contacts } = await loadUnknownRows(access.companyId)
    const contactsByLast10 = new Map<string, ContactRow[]>()
    for (const contact of contacts) {
      const key = last10(contact.phone)
      if (!key) continue
      contactsByLast10.set(key, [...(contactsByLast10.get(key) ?? []), contact])
    }

    type Group = {
      phone: string
      phone_e164: string | null
      last_activity_at: string
      call_count: number
      voicemail_count: number
      matched_contact: ContactRow | null
      events: Array<{
        kind: 'call' | 'voicemail'
        id: string
        created_at: string
        status?: string | null
        direction?: string | null
        duration_seconds?: number | null
        preview?: string | null
      }>
    }

    const groups = new Map<string, Group>()
    function groupFor(rawPhone: string) {
      const key = last10(rawPhone)
      if (!key) return null
      const e164 = toE164(rawPhone)
      const matches = contactsByLast10.get(key) ?? []
      const existing = groups.get(key)
      if (existing) return existing
      const group: Group = {
        phone: e164 || rawPhone,
        phone_e164: e164,
        last_activity_at: '',
        call_count: 0,
        voicemail_count: 0,
        matched_contact: matches.length === 1 ? matches[0] : null,
        events: [],
      }
      groups.set(key, group)
      return group
    }

    for (const call of calls) {
      const group = groupFor(activityPhone(call))
      if (!group) continue
      group.call_count += 1
      if (!group.last_activity_at || call.created_at > group.last_activity_at) {
        group.last_activity_at = call.created_at
      }
      group.events.push({
        kind: 'call',
        id: call.id,
        created_at: call.created_at,
        status: call.status,
        direction: call.direction,
        duration_seconds: call.duration_seconds,
      })
    }

    for (const voicemail of voicemails) {
      const group = groupFor(voicemail.from_number || '')
      if (!group) continue
      group.voicemail_count += 1
      if (!group.last_activity_at || voicemail.created_at > group.last_activity_at) {
        group.last_activity_at = voicemail.created_at
      }
      group.events.push({
        kind: 'voicemail',
        id: voicemail.id,
        created_at: voicemail.created_at,
        duration_seconds: voicemail.recording_duration_sec,
        preview: voicemail.summary || voicemail.transcript,
      })
    }

    for (const group of groups.values()) {
      group.events.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }

    const unknown = [...groups.values()]
      .filter((group) => !group.matched_contact)
      .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))

    return NextResponse.json({ unknown })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load unknown activity' },
      { status: 500 }
    )
  }
}

// POST /api/txt/unknown-activity
// Body: { phone, name? }
// Creates/finds a contact, creates/finds its direct conversation, and stamps
// only still-null calls/voicemails for that phone. This is intentionally
// additive: it never overwrites existing contact links and never deletes rows.
export async function POST(request: Request) {
  const access = await requireUnifiedInboxAccess()
  if ('error' in access) return access.error

  const body = await request.json().catch(() => ({}))
  const phoneE164 = toE164(String(body.phone || ''))
  if (!phoneE164) {
    return NextResponse.json({ error: 'Valid phone is required' }, { status: 400 })
  }
  const name = String(body.name || phoneE164).trim() || phoneE164
  const key = last10(phoneE164)

  try {
    const admin = createAdminClient()
    const { calls, voicemails, contacts } = await loadUnknownRows(access.companyId)
    const matchingContacts = contacts.filter((contact) => last10(contact.phone) === key)

    let contactId = matchingContacts.length === 1 ? matchingContacts[0].id : null
    if (matchingContacts.length > 1) {
      return NextResponse.json(
        { error: 'Multiple contacts already use this phone number. Link it manually.' },
        { status: 409 }
      )
    }
    if (!contactId) {
      const { data: created, error: createErr } = await admin
        .from('txt_contacts')
        .insert({
          company_id: access.companyId,
          phone: phoneE164,
          name,
        })
        .select('id')
        .single()
      if (createErr || !created) {
        return NextResponse.json(
          { error: createErr?.message || 'Contact insert failed' },
          { status: 500 }
        )
      }
      contactId = created.id
    }

    const callIds = calls
      .filter((call) => last10(activityPhone(call)) === key)
      .map((call) => call.id)
    const voicemailIds = voicemails
      .filter((voicemail) => last10(voicemail.from_number) === key)
      .map((voicemail) => voicemail.id)

    if (callIds.length > 0) {
      const { error } = await admin
        .from('calls')
        .update({ contact_id: contactId })
        .in('id', callIds)
        .is('contact_id', null)
      if (error) throw error
    }

    if (voicemailIds.length > 0) {
      const { error } = await admin
        .from('voicemails')
        .update({ contact_id: contactId })
        .in('id', voicemailIds)
        .is('contact_id', null)
      if (error) throw error
    }

    const { data: existingConv } = await admin
      .from('txt_conversations')
      .select('id, status')
      .eq('company_id', access.companyId)
      .eq('contact_id', contactId)
      .eq('kind', 'direct')
      .maybeSingle()

    let conversationId = existingConv?.id ?? null
    if (!conversationId) {
      const { data: createdConv, error: convErr } = await admin
        .from('txt_conversations')
        .insert({
          company_id: access.companyId,
          contact_id: contactId,
          assigned_to: access.userId,
          status: 'assigned',
          kind: 'direct',
        })
        .select('id')
        .single()
      if (convErr || !createdConv) {
        return NextResponse.json(
          { error: convErr?.message || 'Conversation insert failed' },
          { status: 500 }
        )
      }
      conversationId = createdConv.id
      await admin.from('txt_conversation_members').insert({
        conversation_id: conversationId,
        user_id: access.userId,
        role: 'owner',
        added_by: access.userId,
      })
    } else if (existingConv?.status === 'archived') {
      await admin
        .from('txt_conversations')
        .update({ status: 'assigned', assigned_to: access.userId, archived_by: null })
        .eq('id', conversationId)
    }

    return NextResponse.json({
      contact_id: contactId,
      conversation_id: conversationId,
      linked_calls: callIds.length,
      linked_voicemails: voicemailIds.length,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save contact' },
      { status: 500 }
    )
  }
}
