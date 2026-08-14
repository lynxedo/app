// Lead Tracker actions: list_leads, upsert_lead.

import type { ActionContext, HubAction } from './types'
import { limitArg, str, uuidArg } from './types'
import { clip, lines, phone, resolveDateArg, stampLabel } from './format'

const TRACKER_GATE = { anyFlag: ['can_access_tracker'] }

export const listLeadsAction: HubAction = {
  name: 'list_leads',
  description:
    'Leads from the Lead Tracker, newest first, optionally filtered by stage or lead source. Use this ' +
    'for "any new leads today?", "what\'s in the pipeline?", or "how many Angi leads this week?". ' +
    'Returns each lead\'s name, contact info, stage, source, and value.',
  input_schema: {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        description: 'Filter to one stage (e.g. "current", "sold", "lost"). Omit for all stages.',
      },
      source: {
        type: 'string',
        description: 'Filter to one lead source (e.g. "Angi", "Google (GBP / LSA)"). Omit for all.',
      },
      days: { type: 'number', description: 'Only leads created in the last N days (default 14, max 365).' },
      limit: { type: 'number', description: 'Max leads (default 15, max 50).' },
    },
    required: [],
  },
  kind: 'read',
  gate: TRACKER_GATE,
  consentLabel: 'read your sales leads',
  run: async (ctx, args) => {
    const stage = str(args, 'stage')
    const source = str(args, 'source')
    const days = Math.max(1, Math.min(365, Math.round(Number(args.days) || 14)))
    const limit = limitArg(args, 15, 50)
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    let q = ctx.admin
      .from('leads')
      .select(
        'id, first_name, last_name, phone, email, service, lead_source, status, stage, annual_value, service_address, created_at, stage_changed_at',
      )
      .eq('company_id', ctx.actor.companyId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (stage) q = q.ilike('stage', stage)
    if (source) q = q.ilike('lead_source', `%${source.replace(/[%_]/g, '')}%`)

    const { data } = await q
    const leads = (data || []) as Array<{
      id: string
      first_name: string | null
      last_name: string | null
      phone: string | null
      email: string | null
      service: string[] | null
      lead_source: string | null
      status: string | null
      stage: string | null
      annual_value: number | null
      service_address: string | null
      created_at: string
    }>

    if (leads.length === 0) {
      const filters = [stage ? `stage "${stage}"` : null, source ? `source "${source}"` : null]
        .filter(Boolean)
        .join(' and ')
      return `No leads in the last ${days} days${filters ? ` matching ${filters}` : ''}.`
    }

    const bySource = new Map<string, number>()
    for (const l of leads) {
      const key = l.lead_source?.trim() || 'Unknown source'
      bySource.set(key, (bySource.get(key) ?? 0) + 1)
    }
    const mix = [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')

    return lines(
      `${leads.length} lead${leads.length === 1 ? '' : 's'} in the last ${days} days. By source — ${mix}.`,
      ...leads.map((l) => {
        const name = [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'Unnamed lead'
        const svc = Array.isArray(l.service) && l.service.length ? l.service.join(', ') : null
        return lines(
          `• ${name} · ${stampLabel(l.created_at)} · stage: ${l.stage || l.status || 'unset'}` +
            `${l.lead_source ? ` · ${l.lead_source}` : ''}`,
          `  ${phone(l.phone)}${l.email ? ` · ${l.email}` : ''}`,
          svc ? `  wants: ${clip(svc, 120)}` : null,
          l.service_address ? `  at: ${clip(l.service_address, 120)}` : null,
          l.annual_value ? `  annual value: $${Number(l.annual_value).toFixed(0)}` : null,
        )
      }),
    )
  },
}

// ── Writing a sale back to the Tracker ───────────────────────────────────────
//
// The last manual step in job setup. Everything else — client, job, line items,
// visits, recurrence — can be done by the assistant; without this the operator
// still had to open the Tracker and retype the sale by hand every time.
//
// ⚠ The match-then-write shape matters more than the write itself. A lead is
// matched on PHONE, normalised to digits, because that is the only field the
// after-hours receptionist, Jobber and the Tracker all agree on — names are
// typed differently in each. When the phone is stored formatted, the exact-match
// query misses, so a small set of real-world formats is tried too. And when more
// than one lead matches, this REFUSES rather than picking: two rows for one
// person means someone has to decide which is the live one, and silently
// updating the wrong one loses a sale from reporting with no trace.

/** Stages the Tracker actually recognises (see the Hub Tracker board columns). */
const LEAD_STAGES = new Set([
  'current',
  'appointment_set',
  'follow_up_long_term',
  'closed_won',
  'upsells',
  'closed_lost',
  'closed_other',
  'saves',
])

/**
 * Canonical service codes for a SOLD lead — the three the assistant can actually
 * set up (see the job_setup knowledge doc). Reporting groups on this column, so a
 * near-miss silently drops the sale out of its category: on 2026-08-14 a service
 * call went in as "IR SVC" instead of "IRR SC" and stopped counting with the
 * other 309 of them.
 *
 * Deliberately NOT applied to unsold stages. The after-hours receptionist writes
 * the caller's own words here ("sprinkler zones not working", and a hundred
 * others), which is right for a live lead and only needs replacing at the point
 * the sale is recorded.
 */
const SOLD_SERVICE_CODES = new Set(['IRR SC', 'WF - Lawn Health', 'MOS'])

/** Stages where a lead is still live — i.e. a sale could still be closing it. */
const OPEN_STAGES = new Set(['current', 'appointment_set', 'follow_up_long_term'])

/** Digits only — the canonical storage form, and what matching compares. */
function phoneDigits(raw: string): string {
  const d = raw.replace(/\D/g, '')
  // Strip a US country code so "+1 832…" and "832…" match each other.
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
}

/**
 * The formats a phone number is plausibly stored in. Canonical storage is digits
 * only, but rows arrive from several places (receptionist, imports, hand entry)
 * and some carry formatting. Exact `.in()` on a short list beats a LIKE scan:
 * it stays indexed, and it can't accidentally match a different number.
 */
function phoneVariants(digits: string): string[] {
  if (digits.length !== 10) return [digits]
  const [a, b, c] = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)]
  return [
    digits,
    `(${a}) ${b}-${c}`,
    `${a}-${b}-${c}`,
    `${a}.${b}.${c}`,
    `+1${digits}`,
    `1${digits}`,
  ]
}

function strArray(args: Record<string, unknown>, key: string): string[] | null {
  const v = args[key]
  if (Array.isArray(v)) {
    const out = v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
    return out.length ? out : null
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return null
}

type LeadRow = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  service_address: string | null
  stage: string | null
  status: string | null
  lead_source: string | null
  salesperson: string | null
  annual_value: number | string | null
  created_at: string
}

const LEAD_COLS =
  'id, first_name, last_name, phone, email, service_address, stage, status, lead_source, salesperson, annual_value, created_at'

function leadLabel(l: LeadRow): string {
  const name = [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'Unnamed lead'
  return `${name} (${phone(l.phone)}) — stage ${l.stage || 'unset'}, created ${stampLabel(l.created_at)}`
}

export const upsertLeadAction: HubAction = {
  name: 'upsert_lead',
  description:
    'Record a sale (or a stage change) on the Lead Tracker, and add a note to the lead. Use this to ' +
    'close out a job setup: it finds the existing lead by phone and updates it, or creates one if there ' +
    'is no open lead for it to close. ' +
    'The Tracker holds ONE LINE PER SALE, not one per customer: a repeat customer is meant to have ' +
    'several lines, and every service call is its own sale. So a returning customer whose previous ' +
    'sales are all closed gets a NEW line here — that is correct, not a duplicate, and you should say ' +
    'so plainly rather than warning about one. Their name and address are carried over for you. ' +
    'An open lead (the after-hours receptionist usually creates one) is updated instead, because the ' +
    'sale is closing that lead. ' +
    'NEVER guess lead_source or salesperson; if you do not know them, ask. Contact fields you pass are ' +
    'only filled in where the existing lead is blank, so an update cannot quietly overwrite a real name ' +
    'or address with a worse one.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: {
        type: 'string',
        description: 'Update this exact lead. Use it only when a previous call reported several matches.',
      },
      phone: { type: 'string', description: 'Customer phone — how the lead is matched. Any format.' },
      first_name: { type: 'string' },
      last_name: { type: 'string' },
      email: { type: 'string' },
      service_address: { type: 'string' },
      stage: {
        type: 'string',
        enum: [
          'current',
          'appointment_set',
          'follow_up_long_term',
          'closed_won',
          'upsells',
          'closed_lost',
          'closed_other',
          'saves',
        ],
        description: 'Pipeline stage. A sale is "closed_won".',
      },
      status: { type: 'string', description: 'Status label, e.g. "Sold".' },
      service: {
        type: 'array',
        items: { type: 'string' },
        description: 'Canonical service codes, e.g. ["IRR SC"], ["WF - Lawn Health"], ["MOS"].',
      },
      base_program_sold: { type: 'string', description: 'Lead program, e.g. "WF - Root Rot Recovery".' },
      auxiliary_services: {
        type: 'array',
        items: { type: 'string' },
        description: 'Add-on programs, e.g. ["WF - Bed Weed Prevention"].',
      },
      lead_source: { type: 'string', description: 'Where the lead came from. Ask if you do not know it.' },
      salesperson: { type: 'string', description: 'Who sold it. Ask if you do not know.' },
      annual_value: { type: 'number', description: 'Per-visit price × visits per year.' },
      sold_date: { type: 'string', description: '"today" or YYYY-MM-DD.' },
      note: {
        type: 'string',
        description: 'Short summary of the sale — what was sold, price, schedule, Jobber job number.',
      },
    },
    required: [],
  },
  kind: 'write',
  gate: TRACKER_GATE,
  defaultOn: false,
  consentLabel: 'record sales on your Lead Tracker',
  run: async (ctx, args) => {
    const leadId = uuidArg(args, 'lead_id')
    const rawPhone = str(args, 'phone')
    const digits = phoneDigits(rawPhone)
    const lastName = str(args, 'last_name')

    const stage = str(args, 'stage').toLowerCase()
    if (stage && !LEAD_STAGES.has(stage)) {
      return `"${stage}" isn't a Tracker stage. Use one of: ${[...LEAD_STAGES].join(', ')}.`
    }

    const soldRaw = str(args, 'sold_date')
    const soldDate = soldRaw ? resolveDateArg(soldRaw) : ''
    if (soldRaw && !soldDate) return 'sold_date must be "today" or YYYY-MM-DD.'

    const annualRaw = args.annual_value
    let annualValue: number | null = null
    if (annualRaw !== undefined && annualRaw !== null && annualRaw !== '') {
      const n = Number(annualRaw)
      if (!Number.isFinite(n) || n < 0) return 'annual_value must be a positive number.'
      annualValue = n
    }

    const note = str(args, 'note')

    // Reporting groups on the service code, so a
    // plausible-looking variant quietly drops the sale out of its category.
    const serviceCodes = strArray(args, 'service')
    if (stage === 'closed_won' && serviceCodes) {
      const wrong = serviceCodes.filter((s) => !SOLD_SERVICE_CODES.has(s))
      if (wrong.length > 0) {
        return (
          `"${wrong.join('", "')}" ${wrong.length === 1 ? 'is not a' : 'are not'} service code${wrong.length === 1 ? '' : 's'} ` +
          `we record sales under, so nothing was saved. Use exactly one of: ` +
          `${[...SOLD_SERVICE_CODES].map((c) => `"${c}"`).join(', ')}. ` +
          `If the customer described the problem in their own words, that belongs in the note, not here.`
        )
      }
    }

    // -- Find the lead ---------------------------------------------------------
    //
    // ⚠ ONE ROW PER SALE, not one row per customer. A repeat customer is SUPPOSED
    // to have several rows — every service call is its own sale and has to appear
    // on its own line, or the second one never shows up in revenue. 92 customers
    // already look like this, 91 of them with every row closed.
    //
    // So the question is never "does this person exist?", it is "is there an OPEN
    // lead this sale is closing?":
    //   • exactly one open   → this sale came through that lead, update it
    //   • none open          → a fresh sale for a known customer, add a new row
    //   • more than one open → genuinely ambiguous, ask (one customer company-wide)
    //
    // An earlier version refused whenever a phone matched more than once, which
    // read as "duplicate detected" and blocked the single most ordinary case
    // there is: a repeat customer buying again.
    let existing: LeadRow | null = null
    let priorForContact: LeadRow | null = null

    if (leadId) {
      const { data } = await ctx.admin
        .from('leads')
        .select(LEAD_COLS)
        .eq('company_id', ctx.actor.companyId)
        .eq('id', leadId)
        .limit(1)
      existing = ((data || []) as LeadRow[])[0] ?? null
      if (!existing) return "There's no lead with that id on this company's Tracker."
    } else if (digits || lastName) {
      let q = ctx.admin.from('leads').select(LEAD_COLS).eq('company_id', ctx.actor.companyId)
      q = digits ? q.in('phone', phoneVariants(digits)) : q.ilike('last_name', lastName)
      const { data } = await q.order('created_at', { ascending: false }).limit(20)
      const hits = (data || []) as LeadRow[]

      const open = hits.filter((l) => OPEN_STAGES.has((l.stage || '').toLowerCase()))
      if (open.length > 1) {
        return lines(
          `${open.length} leads for this customer are still open, so I won't guess which one this sale ` +
            'closes. Nothing was saved — ask which, then call again with lead_id:',
          ...open.map((l) => `• ${leadLabel(l)} — lead_id ${l.id}`),
        )
      }
      existing = open[0] ?? null
      // Newest row of any stage, used only to carry a known customer's details
      // onto a brand-new row so a repeat sale doesn't have to be re-typed.
      priorForContact = hits[0] ?? null
    } else {
      return 'Give me the phone number so I can find the lead (or lead_id if you already know it).'
    }

    // A sale recorded without its value looks complete and reports as zero, and
    // nobody notices until a revenue number is wrong weeks later. Refuse rather
    // than accept a closed_won with an empty annual_value.
    //
    // Checked HERE, after the lookup, so that re-confirming a stage on a lead
    // that already carries a value isn't blocked for no reason — the guard is
    // about the column ending up empty, not about this call supplying it.
    if (stage === 'closed_won' && annualValue === null) {
      const already = existing?.annual_value
      const hasValue = already !== null && already !== undefined && Number(already) > 0
      if (!hasValue) {
        return (
          "I won't record a sale with no annual value — it would sit in reporting as $0 and nobody " +
          'would spot it. Nothing was saved. Work it out first: an irrigation service call is the ' +
          'call price (usually 125); a WF program is the per-visit total × visits per year; ' +
          'MO Bi-Weekly is the price per visit × 16. Then call me again with annual_value.'
        )
      }
    }

    // -- Build the change ------------------------------------------------------
    const sale: Record<string, unknown> = {}
    if (stage) sale.stage = stage
    if (str(args, 'status')) sale.status = str(args, 'status')
    if (serviceCodes) sale.service = serviceCodes
    if (str(args, 'base_program_sold')) sale.base_program_sold = str(args, 'base_program_sold')
    const aux = strArray(args, 'auxiliary_services')
    if (aux) sale.auxiliary_services = aux
    if (str(args, 'lead_source')) sale.lead_source = str(args, 'lead_source')
    if (str(args, 'salesperson')) sale.salesperson = str(args, 'salesperson')
    if (annualValue !== null) sale.annual_value = annualValue
    if (soldDate) sale.sold_date = soldDate

    // Contact details are fill-the-blanks only on an update. The lead on file was
    // usually taken down by a person on a call; what the assistant has been handed
    // second-hand should not overwrite it.
    const contact = {
      first_name: str(args, 'first_name'),
      last_name: lastName,
      phone: digits,
      email: str(args, 'email'),
      service_address: str(args, 'service_address'),
    }

    if (existing) {
      const filled: string[] = []
      for (const [k, v] of Object.entries(contact)) {
        if (!v) continue
        if (!(existing as unknown as Record<string, string | null>)[k]) {
          sale[k] = v
          filled.push(k.replace(/_/g, ' '))
        }
      }
      if (Object.keys(sale).length === 0 && !note) {
        return 'Nothing to change on that lead, and no note to add. Say what should be recorded.'
      }
      if (Object.keys(sale).length > 0) {
        sale.updated_at = new Date().toISOString()
        if (stage && stage !== existing.stage) sale.stage_changed_at = new Date().toISOString()
        const { error } = await ctx.admin
          .from('leads')
          .update(sale)
          .eq('id', existing.id)
          .eq('company_id', ctx.actor.companyId)
        if (error) return `The Tracker refused that update: ${error.message}. Nothing was saved.`
      }
      const noteResult = await addLeadNote(ctx, existing.id, note)
      return lines(
        `Updated the Tracker lead for ${[existing.first_name, existing.last_name].filter(Boolean).join(' ').trim() || phone(existing.phone)}.`,
        stage ? `  Stage: ${existing.stage || 'unset'} → ${stage}` : null,
        annualValue !== null ? `  Annual value: $${annualValue.toFixed(0)}` : null,
        soldDate ? `  Sold date: ${soldDate}` : null,
        filled.length ? `  Filled in blanks: ${filled.join(', ')}` : null,
        noteResult,
      )
    }

    // -- New row --------------------------------------------------------------
    // Either a customer we've never seen, or — far more often — a known one whose
    // previous sales are all closed. The second case is a REPEAT SALE and gets its
    // own line, which is the point of this whole action.
    const repeat = priorForContact !== null

    // A repeat customer's details are already on file; making the caller retype
    // them would be the fastest way to end up with a name spelt two ways.
    const carried: Record<string, string> = {}
    if (repeat && priorForContact) {
      for (const k of ['first_name', 'last_name', 'phone', 'email', 'service_address'] as const) {
        const v = priorForContact[k]
        if (typeof v === 'string' && v.trim()) carried[k] = v
      }
    }
    const contactFields = { ...carried, ...Object.fromEntries(Object.entries(contact).filter(([, v]) => v)) }

    if (!contactFields.first_name && !contactFields.last_name) {
      return 'This would start a new line on the Tracker, but I have no name to put on it. Ask for the name rather than creating an unnamed lead. Nothing was saved.'
    }

    const insert: Record<string, unknown> = {
      ...sale,
      ...contactFields,
      company_id: ctx.actor.companyId,
    }
    if (stage) insert.stage_changed_at = new Date().toISOString()

    const { data: created, error } = await ctx.admin.from('leads').insert(insert).select('id').limit(1)
    if (error) return `The Tracker refused that new lead: ${error.message}. Nothing was saved.`
    const newId = ((created || []) as Array<{ id: string }>)[0]?.id
    if (!newId) return "The lead didn't save — nothing was added to the Tracker."

    const who = [contactFields.first_name, contactFields.last_name].filter(Boolean).join(' ').trim()
    return lines(
      repeat
        ? `Added a new Tracker line for ${who} — a repeat customer, so this sale sits alongside their earlier ones rather than replacing any.`
        : `Created a new Tracker lead for ${who}.`,
      repeat ? null : `  Nothing on file matched ${phone(digits) || 'that number'}, so this is a first-time customer.`,
      stage ? `  Stage: ${stage}` : null,
      annualValue !== null ? `  Annual value: $${annualValue.toFixed(0)}` : null,
      await addLeadNote(ctx, newId, note),
    )
  },
}

/**
 * Attach the note, attributed to the person who asked. Returns a line for the
 * result — a failed note must NOT fail the whole action, because the sale itself
 * has already been written and reporting a failure would invite a retry that
 * double-writes it.
 */
async function addLeadNote(ctx: ActionContext, leadId: string, note: string): Promise<string | null> {
  if (!note) return null
  const { error } = await ctx.admin.from('lead_notes').insert({
    lead_id: leadId,
    company_id: ctx.actor.companyId,
    note: clip(note, 4000),
    created_by: ctx.actor.displayName,
  })
  return error ? `  ⚠ The sale saved but the note did not (${error.message}) — add it by hand.` : '  Note added.'
}
