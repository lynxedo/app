// Txt actions: search_texts (read) and send_customer_text (OUTWARD — confirmed).

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
