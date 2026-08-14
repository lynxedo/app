// Txt actions: search_texts + read_text_conversation (read) and
// send_customer_text (OUTWARD — confirmed).

import { ilikeSearchPattern } from '@/lib/search'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { toE164 } from '@/lib/phone'
import type { ActionContext, HubAction } from './types'
import { limitArg, str, uuidArg } from './types'
import { clip, contactLabel, lines, phone, stampLabel } from './format'

const TXT_GATE = { anyFlag: ['can_access_txt', 'can_admin_txt', 'can_assign_txt_threads'] }

export const searchTextsAction: HubAction = {
  name: 'search_texts',
  description:
    'Search recent text conversations by message content or customer name. Returns who the thread is ' +
    'with, who owns it, and the latest message. Use this for "did anyone reply about the sprinkler ' +
    'quote?" or "what did the Hamiltons say?".',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text to look for in message bodies, or a customer name. Omit to list the most recent threads.',
      },
      unanswered_only: {
        type: 'boolean',
        description: 'Only threads whose most recent message came FROM the customer (needs a reply).',
      },
      limit: { type: 'number', description: 'Max threads (default 8, max 25).' },
    },
    required: [],
  },
  kind: 'read',
  gate: TXT_GATE,
  consentLabel: 'read text conversations',
  run: async (ctx, args) => {
    const query = str(args, 'query')
    const unansweredOnly = args.unanswered_only === true || args.unanswered_only === 'true'
    const limit = limitArg(args, 8, 25)

    // When searching message bodies, find the matching conversation ids first —
    // a thread matches if ANY of its messages match.
    let conversationIds: string[] | null = null
    if (query) {
      const pattern = ilikeSearchPattern(query)
      const { data: hits } = await ctx.admin
        .from('txt_messages')
        .select('conversation_id')
        .eq('company_id', ctx.actor.companyId)
        .ilike('body', pattern)
        .order('created_at', { ascending: false })
        .limit(300)
      conversationIds = [
        ...new Set(((hits || []) as Array<{ conversation_id: string }>).map((h) => h.conversation_id)),
      ]

      // Also match on the contact's name, then fold those threads in.
      const { data: contacts } = await ctx.admin
        .from('txt_contacts')
        .select('id')
        .eq('company_id', ctx.actor.companyId)
        .is('deleted_at', null)
        .ilike('name', pattern)
        .limit(50)
      const contactIds = ((contacts || []) as Array<{ id: string }>).map((c) => c.id)
      if (contactIds.length) {
        const { data: byContact } = await ctx.admin
          .from('txt_conversations')
          .select('id')
          .eq('company_id', ctx.actor.companyId)
          .in('contact_id', contactIds)
          .limit(50)
        for (const row of (byContact || []) as Array<{ id: string }>) {
          if (!conversationIds.includes(row.id)) conversationIds.push(row.id)
        }
      }

      if (conversationIds.length === 0) {
        return `Nothing in the text history matches "${query}".`
      }
    }

    let q = ctx.admin
      .from('txt_conversations')
      .select(
        `id, status, assigned_to, last_message_at, last_message_preview, last_message_direction, archived_by,
         contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, first_name, last_name, phone, do_not_text )`,
      )
      .eq('company_id', ctx.actor.companyId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (conversationIds) {
      // .in() URL length: cap the id list (lesson_supabase_in_url_length).
      q = q.in('id', conversationIds.slice(0, 100))
    }
    if (unansweredOnly) q = q.eq('last_message_direction', 'inbound')

    const { data } = await q
    const rows = (data || []) as Array<{
      id: string
      status: string | null
      assigned_to: string | null
      last_message_at: string | null
      last_message_preview: string | null
      last_message_direction: string | null
      archived_by: string | null
      contact:
        | { id: string; name: string | null; first_name: string | null; last_name: string | null; phone: string | null; do_not_text: boolean | null }
        | Array<{ id: string; name: string | null; first_name: string | null; last_name: string | null; phone: string | null; do_not_text: boolean | null }>
        | null
    }>

    if (rows.length === 0) {
      return unansweredOnly
        ? 'No text threads are currently waiting on a reply from us.'
        : 'No text conversations found.'
    }

    // Resolve owner display names in one batch.
    const ownerIds = [...new Set(rows.map((r) => r.assigned_to).filter((id): id is string => Boolean(id)))]
    const ownerById = new Map<string, string>()
    if (ownerIds.length) {
      const { data: owners } = await ctx.admin
        .from('hub_users')
        .select('id, display_name')
        .eq('company_id', ctx.actor.companyId)
        .in('id', ownerIds)
      for (const o of (owners || []) as Array<{ id: string; display_name: string | null }>) {
        ownerById.set(o.id, (o.display_name || 'someone').trim())
      }
    }

    return rows
      .map((r) => {
        const c = Array.isArray(r.contact) ? r.contact[0] : r.contact
        const who = c ? contactLabel(c) : 'Unknown'
        const owner = r.assigned_to ? ownerById.get(r.assigned_to) || 'someone' : 'unassigned (in the Queue)'
        const dir = r.last_message_direction === 'inbound' ? 'from them' : 'from us'
        return lines(
          `• ${who}${c?.phone ? ` — ${phone(c.phone)}` : ''}${c?.id ? ` — contact id ${c.id}` : ''}`,
          `  owner: ${owner}${r.archived_by ? ' · archived' : ''}`,
          r.last_message_preview
            ? `  last (${dir}, ${stampLabel(r.last_message_at)}): ${clip(r.last_message_preview, 160)}`
            : null,
          c?.do_not_text ? '  ⚠ opted out of texts' : null,
        )
      })
      .join('\n')
  },
}

type ThreadRow = {
  id: string
  kind: string | null
  assigned_to: string | null
  archived_by: string | null
  last_message_at: string | null
  contact_id: string | null
  lsa_relay: boolean | null
  lsa_location: string | null
  lsa_service: string | null
}

const THREAD_COLS =
  'id, kind, assigned_to, archived_by, last_message_at, contact_id, lsa_relay, lsa_location, lsa_service'

type ThreadContact = {
  id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  do_not_text: boolean | null
}

export const readTextConversationAction: HubAction = {
  name: 'read_text_conversation',
  description:
    'Read the actual back-and-forth of one text conversation — every message in order, who sent it, ' +
    'and when. Use this whenever you need what was ACTUALLY said, rather than the one-line preview ' +
    'search_texts gives you: "what did we tell the Hamiltons?", "read my texts with Bill", "catch me ' +
    'up on that thread". Pass the contact_id from find_contact or search_texts. Messages we sent that ' +
    'failed are marked — never describe a failed message as something the customer received, and ' +
    'never quote a photo you cannot see.',
  input_schema: {
    type: 'object',
    properties: {
      contact_id: {
        type: 'string',
        description: 'The contact id from find_contact or search_texts. Their most active thread is used.',
      },
      conversation_id: {
        type: 'string',
        description: 'A specific thread id, when you already have one. Overrides contact_id.',
      },
      limit: {
        type: 'number',
        description: 'How many of the most recent messages to read (default 20, max 60).',
      },
    },
    required: [],
  },
  kind: 'read',
  gate: TXT_GATE,
  consentLabel: 'read text conversations',
  run: async (ctx, args) => {
    const conversationId = uuidArg(args, 'conversation_id')
    const contactId = uuidArg(args, 'contact_id')
    const limit = limitArg(args, 20, 60)

    if (!conversationId && !contactId) {
      return (
        'Provide a contact_id (from find_contact or search_texts) or a conversation_id. Do not guess ' +
        'an id — look the person up first.'
      )
    }

    // Resolve the thread. Every lookup is scoped by company: an id is not
    // authorization, and this client bypasses RLS.
    let thread: ThreadRow | null = null
    if (conversationId) {
      const { data } = await ctx.admin
        .from('txt_conversations')
        .select(THREAD_COLS)
        .eq('company_id', ctx.actor.companyId)
        .eq('id', conversationId)
        .maybeSingle()
      thread = (data as ThreadRow | null) ?? null
      if (!thread) return 'No text conversation with that id in this company.'
    } else if (contactId) {
      // A contact can sit in several threads (their own, plus any group). Take
      // their direct thread when there is one — that's the conversation a person
      // means by "my texts with them" — otherwise the most recently active.
      const { data } = await ctx.admin
        .from('txt_conversations')
        .select(THREAD_COLS)
        .eq('company_id', ctx.actor.companyId)
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(10)
      const rows = (data || []) as ThreadRow[]
      thread = rows.find((r) => r.kind === 'direct') ?? rows[0] ?? null
    }

    // The contact is loaded separately rather than joined, so a thread reached by
    // conversation_id still names who it is with.
    const threadContactId = thread?.contact_id ?? contactId
    let contact: ThreadContact | null = null
    if (threadContactId) {
      const { data } = await ctx.admin
        .from('txt_contacts')
        .select('id, name, first_name, last_name, phone, do_not_text')
        .eq('company_id', ctx.actor.companyId)
        .eq('id', threadContactId)
        .is('deleted_at', null)
        .maybeSingle()
      contact = (data as ThreadContact | null) ?? null
    }

    if (!thread) {
      if (!contact) return 'No contact with that id in this company.'
      return `There is no text conversation with ${contactLabel(contact)} yet — nothing has been texted either way.`
    }

    const { data: msgData, count } = await ctx.admin
      .from('txt_messages')
      .select('id, direction, body, media_urls, sent_by, contact_id, status, error_message, created_at, is_ai', {
        count: 'exact',
      })
      .eq('company_id', ctx.actor.companyId)
      .eq('conversation_id', thread.id)
      // Newest first so the window is the RECENT end of a long thread; reversed
      // below so the model reads it as a conversation, oldest to newest. The id
      // tiebreak keeps two messages sharing a timestamp in a STABLE order, so
      // reading the same thread twice can't quietly reorder or drop one at the
      // limit boundary.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)

    const msgs = ((msgData || []) as Array<{
      id: string
      direction: string | null
      body: string | null
      media_urls: string[] | null
      sent_by: string | null
      contact_id: string | null
      status: string | null
      error_message: string | null
      created_at: string
      is_ai: boolean | null
    }>).slice().reverse()

    const who = contact ? contactLabel(contact) : 'an unknown number'

    if (msgs.length === 0) {
      return `The thread with ${who} exists but has no messages in it.`
    }

    // Resolve our senders' names in one batch (hub_users includes bot senders,
    // which is how an AI-sent text reads as the assistant's own name). The
    // thread owner rides along in the same lookup.
    const ownerId = thread.assigned_to
    const senderIds = [
      ...new Set(
        [...msgs.map((m) => m.sent_by), ownerId].filter((v): v is string => Boolean(v)),
      ),
    ]
    const senderById = new Map<string, string>()
    if (senderIds.length) {
      const { data: users } = await ctx.admin
        .from('hub_users')
        .select('id, display_name')
        .eq('company_id', ctx.actor.companyId)
        .in('id', senderIds)
      for (const u of (users || []) as Array<{ id: string; display_name: string | null }>) {
        senderById.set(u.id, (u.display_name || 'a teammate').trim())
      }
    }

    // In a group thread an inbound message can come from any participant, so its
    // own contact_id is the sender — not the thread's contact.
    const otherContactIds = [
      ...new Set(
        msgs
          .filter((m) => m.direction === 'inbound' && m.contact_id && m.contact_id !== threadContactId)
          .map((m) => m.contact_id as string),
      ),
    ]
    const otherById = new Map<string, string>()
    if (otherContactIds.length) {
      const { data: others } = await ctx.admin
        .from('txt_contacts')
        .select('id, name, first_name, last_name, phone')
        .eq('company_id', ctx.actor.companyId)
        .in('id', otherContactIds.slice(0, 50))
      for (const o of (others || []) as Array<{
        id: string
        name: string | null
        first_name: string | null
        last_name: string | null
        phone: string | null
      }>) {
        otherById.set(o.id, contactLabel(o))
      }
    }

    const ownerName = ownerId
      ? senderById.get(ownerId) ?? 'someone'
      : 'nobody yet (it sits in the Queue)'

    const total = typeof count === 'number' ? count : msgs.length
    const shown =
      total > msgs.length
        ? `showing the last ${msgs.length} of ${total} messages`
        : `${msgs.length} message${msgs.length === 1 ? '' : 's'}`

    const body = msgs.map((m) => {
      const inbound = m.direction === 'inbound'
      const label = inbound
        ? (m.contact_id && otherById.get(m.contact_id)) || (contact ? contactLabel(contact) : 'them')
        : `${m.sent_by ? senderById.get(m.sent_by) ?? 'a teammate' : 'automated'}${m.is_ai ? ' (AI)' : ''}`

      const photos = Array.isArray(m.media_urls) ? m.media_urls.length : 0
      // Deliberately no media URL: viewing one needs a Hub session, so a link
      // here would be useless to the reader and pointless to hand out.
      const attach = photos > 0 ? `[${photos} photo${photos === 1 ? '' : 's'} attached] ` : ''
      const failed =
        !inbound && m.status === 'failed'
          ? `  ⚠ THIS ONE FAILED TO SEND${m.error_message ? ` (${clip(m.error_message, 80)})` : ''} — they never received it.`
          : null

      return lines(
        `${stampLabel(m.created_at)} · ${inbound ? '←' : '→'} ${label}: ${attach}${clip(m.body || '(no text)', 700)}`,
        failed,
      )
    })

    return lines(
      `Text thread with ${who}${contact?.phone ? ` — ${phone(contact.phone)}` : ''}${
        contact ? ` — contact id ${contact.id}` : ''
      }`,
      `Owner: ${ownerName} · ${shown}${thread.kind === 'group' ? ' · GROUP thread' : ''}${
        thread.archived_by ? ' · archived' : ''
      }`,
      thread.lsa_relay
        ? `Google Local Services lead relay${thread.lsa_location ? ` — ${thread.lsa_location}` : ''}${
            thread.lsa_service ? ` · ${thread.lsa_service}` : ''
          }`
        : null,
      contact?.do_not_text
        ? '⚠ This contact has opted out of texts — you cannot text them, only call.'
        : null,
      '← means from them, → means from us.',
      ...body,
    )
  },
}

/**
 * Resolve + validate everything needed to text someone, shared by the preview
 * and the execute pass so the confirmed send can never differ from the preview.
 */
async function resolveTextTarget(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; contactId: string; label: string; e164: string; body: string }
  | { ok: false; message: string }
> {
  const contactId = uuidArg(args, 'contact_id')
  const body = str(args, 'message')
  if (!contactId) {
    return { ok: false, message: 'Provide a contact_id from find_contact. Never text a number you were not given by a lookup.' }
  }
  if (!body) return { ok: false, message: 'Provide the message text to send.' }
  if (body.length > 1200) {
    return { ok: false, message: 'That message is too long for a text. Keep it under about 1200 characters.' }
  }

  const { data } = await ctx.admin
    .from('txt_contacts')
    .select('id, name, first_name, last_name, phone, do_not_text')
    .eq('company_id', ctx.actor.companyId)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data) return { ok: false, message: 'No contact with that id in this company.' }
  const c = data as {
    id: string
    name: string | null
    first_name: string | null
    last_name: string | null
    phone: string | null
    do_not_text: boolean | null
  }

  if (c.do_not_text) {
    return {
      ok: false,
      message: `${contactLabel(c)} has opted out of text messages. I can't text them — that's a compliance rule, not a preference. Suggest calling instead.`,
    }
  }
  const e164 = c.phone ? toE164(c.phone) : null
  if (!e164) {
    return { ok: false, message: `${contactLabel(c)} has no usable mobile number on file, so there's nothing to text.` }
  }

  return { ok: true, contactId: c.id, label: contactLabel(c), e164, body }
}

export const sendCustomerTextAction: HubAction = {
  name: 'send_customer_text',
  description:
    'Send a text message to a customer. This reaches a real person, so it is a two-step action: this ' +
    'call only PREVIEWS the message and returns a confirmation id — nothing is sent. Show the preview ' +
    'to the user, and only if they approve, call confirm_action with that id. Requires a contact_id ' +
    'from find_contact; never text a number you assembled yourself. The company signature and any ' +
    'required opt-out language are added automatically — do not write them into the message.',
  input_schema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', description: 'The contact id from find_contact.' },
      message: { type: 'string', description: 'The message body, in plain conversational text.' },
    },
    required: ['contact_id', 'message'],
  },
  kind: 'outward',
  gate: TXT_GATE,
  consentLabel: 'text customers (with your confirmation)',
  run: async (ctx, args) => {
    // Reached only on the CONFIRMED pass — the dispatcher intercepts the first
    // call and stages a preview instead (see catalog.ts).
    const target = await resolveTextTarget(ctx, args)
    if (!target.ok) return target.message

    const res = await sendDirectTxtToPhone({
      admin: ctx.admin,
      companyId: ctx.actor.companyId,
      // The thread is owned by the human who asked, so the customer's reply
      // routes back to a person — not into a bot's lap.
      userId: ctx.actor.userId,
      phone: target.e164,
      name: target.label,
      body: target.body,
    })

    if (!res.ok) {
      return `The text to ${target.label} did NOT send (${res.error || 'unknown error'}). Tell the user it failed so they can follow up another way.`
    }
    return `Sent. ${target.label} (${phone(target.e164)}) has been texted, and their reply will come back into the Txt inbox under your name.`
  },
}

/** Build the human-facing preview for a staged customer text. */
export async function previewCustomerText(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<{ ok: true; preview: string } | { ok: false; message: string }> {
  const target = await resolveTextTarget(ctx, args)
  if (!target.ok) return { ok: false, message: target.message }
  return {
    ok: true,
    preview: lines(
      `  To: ${target.label} — ${phone(target.e164)}`,
      `  Message: "${target.body}"`,
      '  (The company signature and opt-out line are appended automatically.)',
    ),
  }
}
