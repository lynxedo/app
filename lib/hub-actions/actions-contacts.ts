// Contact + customer actions: find_contact, get_customer_overview, add_contact_note.

import { formatCurrency } from '@/lib/format'
import { ilikeSearchPattern } from '@/lib/search'
import type { ActionContext, HubAction } from './types'
import { actorPassesGate, limitArg, str, uuidArg } from './types'
import { clip, contactLabel, dayLabel, lines, opsYmd, phone, stampLabel } from './format'

// The texts/calls sections below expose exactly what the gated surfaces expose
// (app/api/txt/timeline requires can_access_unified_inbox/can_access_txt; the Call
// Log requires its own flags), and search_texts / get_call_activity in this very
// layer are gated. So this action stays ungated for identity + schedule, and gates
// those two sections per-actor — otherwise the gates elsewhere are cosmetic.
const TXT_VIEW_GATE = { anyFlag: ['can_access_txt', 'can_admin_txt', 'can_access_unified_inbox'] }
const CALL_VIEW_GATE = {
  anyFlag: ['can_access_call_log', 'can_access_call_log2', 'can_access_dialer', 'can_admin_dialer'],
}

const CONTACT_COLS =
  'id, name, first_name, last_name, phone, email, do_not_text, do_not_call, ' +
  'address_line1, city, state, postal_code, jobber_client_id, notes, name_source, archived_at'

type ContactRow = {
  id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  do_not_text: boolean | null
  do_not_call: boolean | null
  address_line1: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  jobber_client_id: string | null
  notes: string | null
  name_source: string | null
  archived_at: string | null
}

function addressLine(c: ContactRow): string | null {
  const parts = [c.address_line1, c.city, [c.state, c.postal_code].filter(Boolean).join(' ')]
    .map((p) => (p || '').trim())
    .filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/**
 * Find contacts by name, phone, or email. Digit-normalized so any phone format
 * the user speaks or types matches (the project_contact_quality search fix).
 */
async function searchContacts(
  ctx: ActionContext,
  query: string,
  limit: number,
): Promise<ContactRow[]> {
  const pattern = ilikeSearchPattern(query)
  const digits = query.replace(/\D/g, '').slice(-10)
  const or = [`name.ilike.${pattern}`, `phone.ilike.${pattern}`, `email.ilike.${pattern}`]
  // digits is stripped to [0-9] so it can't break out of the .or() filter string.
  if (digits.length >= 3) or.push(`phone_digits.ilike.%${digits}%`)

  const { data } = await ctx.admin
    .from('txt_contacts')
    .select(CONTACT_COLS)
    .eq('company_id', ctx.actor.companyId)
    .is('deleted_at', null)
    .or(or.join(','))
    .order('updated_at', { ascending: false })
    .limit(limit)
  // Double cast: CONTACT_COLS is a shared const, and PostgREST's row typing only
  // infers from a literal select string — so the inferred type is unrelated here.
  return (data || []) as unknown as ContactRow[]
}

export const findContactAction: HubAction = {
  name: 'find_contact',
  description:
    'Search this company\'s contact directory by name, phone number, or email. Returns matching ' +
    'contacts with their id, phone, email, address, and contact preferences. Use this FIRST whenever ' +
    'the user names a customer — you need the contact id for other actions, and you must never guess ' +
    'a phone number. Any phone format works.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A name, phone number, or email to search for.' },
      limit: { type: 'number', description: 'Max results (default 5, max 25).' },
    },
    required: ['query'],
  },
  kind: 'read',
  gate: null,
  consentLabel: 'search your contacts',
  run: async (ctx, args) => {
    const query = str(args, 'query')
    if (!query) return 'Provide a name, phone number, or email to search for.'
    const rows = await searchContacts(ctx, query, limitArg(args, 5, 25))
    if (rows.length === 0) {
      return `No contact matches "${query}". They may not be in the directory — do not invent a phone number or email.`
    }
    return rows
      .map((c) => {
        const flags = [
          c.do_not_text ? 'DO NOT TEXT (opted out)' : null,
          c.do_not_call ? 'do not call' : null,
          c.archived_at ? 'archived' : null,
          c.jobber_client_id ? 'Jobber customer' : null,
        ]
          .filter(Boolean)
          .join('; ')
        return lines(
          `• ${contactLabel(c)} — id ${c.id}`,
          `  phone: ${phone(c.phone)}${c.email ? ` · email: ${c.email}` : ''}`,
          addressLine(c) ? `  address: ${addressLine(c)}` : null,
          flags ? `  flags: ${flags}` : null,
        )
      })
      .join('\n')
  },
}

export const customerOverviewAction: HubAction = {
  name: 'get_customer_overview',
  description:
    'The full picture for one contact: their details, whether they are an active customer, their ' +
    'upcoming and most recent visits with the service, recent text and call activity, and any saved ' +
    'notes. Use this to answer "what\'s going on with this customer?" or "when is their next visit?". ' +
    'Requires a contact id from find_contact.',
  input_schema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', description: 'The contact id returned by find_contact.' },
    },
    required: ['contact_id'],
  },
  kind: 'read',
  gate: null,
  consentLabel: 'read customer details and history',
  run: async (ctx, args) => {
    const contactId = uuidArg(args, 'contact_id')
    if (!contactId) return 'Provide a valid contact_id from find_contact.'

    const { data: contactData } = await ctx.admin
      .from('txt_contacts')
      .select(CONTACT_COLS)
      .eq('company_id', ctx.actor.companyId)
      .eq('id', contactId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!contactData) return 'No contact with that id in this company.'
    const c = contactData as unknown as ContactRow

    const out: string[] = [
      `${contactLabel(c)} (contact id ${c.id})`,
      `Phone: ${phone(c.phone)}${c.email ? ` · Email: ${c.email}` : ''}`,
    ]
    const addr = addressLine(c)
    if (addr) out.push(`Address: ${addr}`)
    if (c.do_not_text) out.push('⚠ This contact has opted out of texts (do_not_text). Do not text them.')

    // Jobber customer record (local mirror) — status + balance.
    if (c.jobber_client_id) {
      const { data: client } = await ctx.admin
        .from('clients')
        .select('id, is_lead, is_archived, balance, customer_since, lead_source, sales_person')
        .eq('company_id', ctx.actor.companyId)
        .eq('external_id', c.jobber_client_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (client) {
        const cl = client as {
          id: string
          is_lead: boolean | null
          is_archived: boolean | null
          balance: number | null
          customer_since: string | null
          lead_source: string | null
          sales_person: string | null
        }
        const status = cl.is_archived ? 'past/archived customer' : cl.is_lead ? 'lead' : 'active customer'
        out.push(
          `Status: ${status}${cl.customer_since ? ` since ${cl.customer_since}` : ''}` +
            `${cl.lead_source ? ` · source: ${cl.lead_source}` : ''}` +
            `${cl.sales_person ? ` · sales: ${cl.sales_person}` : ''}`,
        )
        if (cl.balance != null && Number(cl.balance) !== 0) {
          out.push(
            `Account balance: ${formatCurrency(Number(cl.balance))} — internal only. Never state a balance ` +
              'or amount owed to the customer; route billing questions to a teammate.',
          )
        }

        // Visits from the local Jobber mirror (webhook + nightly synced).
        const today = opsYmd()
        const { data: upcoming } = await ctx.admin
          .from('visits')
          .select('title, scheduled_date, visit_status')
          .eq('company_id', ctx.actor.companyId)
          .eq('client_id', cl.id)
          .is('deleted_at', null)
          .is('completed_at', null)
          .gte('scheduled_date', today)
          .order('scheduled_date', { ascending: true })
          .limit(3)
        const up = (upcoming || []) as Array<{ title: string | null; scheduled_date: string | null }>
        if (up.length && up[0].scheduled_date) {
          out.push(
            `Next visit: ${dayLabel(up[0].scheduled_date)}${up[0].title ? ` — ${up[0].title}` : ''}` +
              (up.length > 1 ? ` (plus ${up.length - 1} more scheduled)` : ''),
          )
        } else {
          out.push('Next visit: nothing upcoming on the schedule.')
        }

        const { data: recent } = await ctx.admin
          .from('visits')
          .select('title, scheduled_date, completed_at')
          .eq('company_id', ctx.actor.companyId)
          .eq('client_id', cl.id)
          .is('deleted_at', null)
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false })
          .limit(1)
        const rv = (recent || [])[0] as { title: string | null; completed_at: string | null } | undefined
        if (rv?.completed_at) {
          out.push(`Last completed visit: ${stampLabel(rv.completed_at)}${rv.title ? ` — ${rv.title}` : ''}`)
        }
      }
    } else {
      out.push('Status: not linked to a Jobber customer record (lead or manually added contact).')
    }

    // Recent text activity — only for actors who can see texts in the product.
    if (actorPassesGate(ctx.actor, TXT_VIEW_GATE)) {
    const { data: msgs } = await ctx.admin
      .from('txt_messages')
      .select('direction, body, created_at')
      .eq('company_id', ctx.actor.companyId)
      .eq('contact_id', c.id)
      .order('created_at', { ascending: false })
      .limit(4)
    const messages = (msgs || []) as Array<{ direction: string; body: string | null; created_at: string }>
    if (messages.length) {
      out.push('Recent texts (newest first):')
      for (const m of messages) {
        const who = m.direction === 'inbound' ? 'Them' : 'Us'
        out.push(`  [${who} · ${stampLabel(m.created_at)}] ${clip(m.body || '(no text)', 160)}`)
      }
    }
    }

    // Recent calls — same reasoning as texts above.
    if (actorPassesGate(ctx.actor, CALL_VIEW_GATE)) {
    const { data: callRows } = await ctx.admin
      .from('calls')
      .select('direction, status, duration_seconds, created_at, ai_summary')
      .eq('company_id', ctx.actor.companyId)
      .eq('contact_id', c.id)
      .order('created_at', { ascending: false })
      .limit(2)
    const calls = (callRows || []) as Array<{
      direction: string
      status: string | null
      duration_seconds: number | null
      created_at: string
      ai_summary: string | null
    }>
    if (calls.length) {
      out.push('Recent calls:')
      for (const cl of calls) {
        out.push(
          `  [${cl.direction} · ${stampLabel(cl.created_at)}] ${cl.status || 'unknown'}` +
            `${cl.duration_seconds ? `, ${cl.duration_seconds}s` : ''}` +
            `${cl.ai_summary ? ` — ${clip(cl.ai_summary, 200)}` : ''}`,
        )
      }
    }
    }

    if (c.notes?.trim()) out.push(`Saved notes: ${clip(c.notes, 600)}`)

    return out.join('\n')
  },
}

export const addContactNoteAction: HubAction = {
  name: 'add_contact_note',
  description:
    'Append a dated note to a contact\'s record — what a customer asked for, what was promised, what ' +
    'to follow up on. Notes are visible to the whole team on the customer screen. Requires a contact id.',
  input_schema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', description: 'The contact id from find_contact.' },
      note: { type: 'string', description: 'The note text to append.' },
    },
    required: ['contact_id', 'note'],
  },
  kind: 'write',
  gate: null,
  consentLabel: 'add notes to contacts',
  run: async (ctx, args) => {
    const contactId = uuidArg(args, 'contact_id')
    const note = str(args, 'note')
    if (!contactId) return 'Provide a valid contact_id from find_contact.'
    if (!note) return 'Provide the note text.'
    if (note.length > 2000) return 'That note is too long — keep it under about 2000 characters.'

    const { data: existing } = await ctx.admin
      .from('txt_contacts')
      .select('id, name, phone, notes')
      .eq('company_id', ctx.actor.companyId)
      .eq('id', contactId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!existing) return 'No contact with that id in this company.'
    const row = existing as { id: string; name: string | null; phone: string | null; notes: string | null }

    // Append rather than overwrite — the notes column is shared with the CRM
    // customer screen and hand-typed history must survive.
    const stamp = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date())
    const entry = `[${stamp} · ${ctx.actor.displayName} via assistant] ${note}`
    const merged = row.notes?.trim() ? `${row.notes.trim()}\n${entry}` : entry

    const { error } = await ctx.admin
      .from('txt_contacts')
      .update({ notes: merged, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('company_id', ctx.actor.companyId)
    if (error) return "I couldn't save that note just now."

    return `Note added to ${contactLabel(row)}.`
  },
}
