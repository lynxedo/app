// Jobber actions — native and tenant-scoped.
//
// WHY THESE EXIST. Guardian could already touch Jobber, but only through the
// original single-tenant Heroes105 MCP server (mcp.lynxedo.com), which holds
// Heroes' own OAuth token. That server is now pinned to Heroes' company id, so
// every other subscriber had no Jobber access at all — and even for Heroes those
// tools were gated by the legacy basic/manager/full tier system, so they never
// appeared in the per-action admin allow-list.
//
// These native actions fix both: `companyJobberUserId(companyId)` resolves the
// asking company's OWN Jobber token (multi-tenant Track 3), and they sit under the
// same permission gates, confirmation model, and admin checklist as every other
// action.
//
// ⚠ The GraphQL operation names and input shapes here are taken from the WORKING
// implementation in the Heroes MCP server (`Jobber MCP/server.js`) rather than
// guessed — Jobber's schema has real traps. Two worth knowing:
//   • Rescheduling is `visitEditSchedule`, NOT `visitEdit` (VisitEditAttributes
//     only carries title/instructions — no dates at all).
//   • `clientCreateNote` REQUIRES an explicit `linkedTo` block. Omit it and Jobber
//     links the note to every related job, invoice, quote and request, cluttering
//     all of them.

import { companyJobberUserId, jobberGraphQLAdmin } from '@/lib/jobber'
import { formatCurrency } from '@/lib/format'
import type { ActionContext, HubAction } from './types'
import { limitArg, str } from './types'
import { addDays, dayLabel, lines, opsYmd, resolveDateArg, stampLabel } from './format'

/** Jobber's operating timezone for schedule writes (matches lib/voice-scheduling). */
const JOBBER_TZ = 'America/Chicago'

/**
 * Changing the schedule is a manager action: it moves real crews. Reads stay open
 * to any Hub user. There is no `can_access_jobber` flag in the app, so this uses
 * the closest existing manager signals plus the admin bypass built into the gate.
 */
const JOBBER_WRITE_GATE = {
  anyFlag: ['can_admin_dialer', 'can_admin_daily_log', 'can_admin_routing', 'can_admin_products', 'can_admin_people'],
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Resolve the company's Jobber token holder, or a readable reason we can't. */
async function jobberUser(ctx: ActionContext): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  try {
    const userId = await companyJobberUserId(ctx.actor.companyId, '')
    if (!userId) {
      return {
        ok: false,
        message:
          "This company isn't connected to Jobber, so I can't look that up. An admin can connect it in Admin → Integrations.",
      }
    }
    return { ok: true, userId }
  } catch {
    return { ok: false, message: "I couldn't reach Jobber just now. Tell the user to try again shortly." }
  }
}

/** Split a date + optional HH:MM into the { date, time, timezone } shape Jobber wants. */
function localDateTime(date: string, hhmm: string): Record<string, string> {
  return { date, ...(HHMM_RE.test(hhmm) ? { time: `${hhmm}:00` } : {}), timezone: JOBBER_TZ }
}

function userErrorText(errors: Array<{ message: string }> | undefined | null): string | null {
  if (!errors || errors.length === 0) return null
  return errors.map((e) => e.message).join('; ')
}

// ── Reads ────────────────────────────────────────────────────────────────────

const CLIENT_SEARCH = `
  query HubAssistantClients($q: String!) {
    clients(first: 8, searchTerm: $q) {
      nodes {
        id
        name
        companyName
        isArchived
        balance
        emails { address }
        phones { number }
        billingAddress { street city province postalCode }
      }
    }
  }
`

export const jobberFindCustomerAction: HubAction = {
  name: 'jobber_find_customer',
  description:
    'Search Jobber directly for a customer by name, email, or phone, and get their LIVE record: ' +
    'contact details, billing address, account balance, and whether they are archived. Use this when ' +
    'you need the Jobber customer id for another Jobber action, or when the local contact record ' +
    "might be stale. For everyday lookups prefer find_contact — it's faster.",
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Name, email, or phone to search Jobber for.' } },
    required: ['query'],
  },
  kind: 'read',
  gate: null,
  group: 'jobber',
  consentLabel: 'look up customers in Jobber',
  run: async (ctx, args) => {
    const q = str(args, 'query')
    if (!q) return 'Provide something to search Jobber for.'
    const ju = await jobberUser(ctx)
    if (!ju.ok) return ju.message

    const resp = await jobberGraphQLAdmin<{
      data?: {
        clients?: {
          nodes?: Array<{
            id: string
            name: string | null
            companyName: string | null
            isArchived: boolean | null
            balance: number | null
            emails?: Array<{ address: string | null }>
            phones?: Array<{ number: string | null }>
            billingAddress?: { street: string | null; city: string | null; province: string | null; postalCode: string | null } | null
          }>
        }
      }
    }>(ju.userId, CLIENT_SEARCH, { q })

    const nodes = resp.data?.clients?.nodes ?? []
    if (nodes.length === 0) {
      return `No Jobber customer matches "${q}". Don't invent an id — ask the user to check the spelling.`
    }
    return nodes
      .map((c) => {
        const addr = c.billingAddress
          ? [c.billingAddress.street, c.billingAddress.city, c.billingAddress.province, c.billingAddress.postalCode]
              .filter(Boolean)
              .join(', ')
          : ''
        return lines(
          `• ${c.name || c.companyName || 'Unnamed'} — Jobber client id ${c.id}${c.isArchived ? ' (ARCHIVED)' : ''}`,
          c.phones?.[0]?.number || c.emails?.[0]?.address
            ? `  ${[c.phones?.[0]?.number, c.emails?.[0]?.address].filter(Boolean).join(' · ')}`
            : null,
          addr ? `  ${addr}` : null,
          c.balance != null && Number(c.balance) !== 0
            ? `  balance ${formatCurrency(Number(c.balance))} — internal only, never state a balance to the customer`
            : null,
        )
      })
      .join('\n')
  },
}

const CLIENT_JOBS = `
  query HubAssistantClientJobs($clientId: EncodedId!) {
    client(id: $clientId) {
      id
      name
      jobs(first: 20) {
        nodes {
          id
          jobNumber
          title
          jobStatus
          total
          visits(first: 3, filter: { status: UPCOMING }) { nodes { id title startAt } }
        }
      }
    }
  }
`

export const jobberCustomerJobsAction: HubAction = {
  name: 'jobber_get_customer_jobs',
  description:
    "A Jobber customer's jobs with status, value, and next upcoming visits. Use this to answer " +
    '"what work do we have on the books for them?" Needs a Jobber client id from jobber_find_customer.',
  input_schema: {
    type: 'object',
    properties: { client_id: { type: 'string', description: 'Jobber client id from jobber_find_customer.' } },
    required: ['client_id'],
  },
  kind: 'read',
  gate: null,
  group: 'jobber',
  consentLabel: 'see a customer’s jobs in Jobber',
  run: async (ctx, args) => {
    const clientId = str(args, 'client_id')
    if (!clientId) return 'Provide a Jobber client_id from jobber_find_customer.'
    const ju = await jobberUser(ctx)
    if (!ju.ok) return ju.message

    const resp = await jobberGraphQLAdmin<{
      data?: {
        client?: {
          name: string | null
          jobs?: {
            nodes?: Array<{
              id: string
              jobNumber: number | null
              title: string | null
              jobStatus: string | null
              total: number | null
              visits?: { nodes?: Array<{ id: string; title: string | null; startAt: string | null }> }
            }>
          }
        } | null
      }
    }>(ju.userId, CLIENT_JOBS, { clientId })

    const client = resp.data?.client
    if (!client) return "No Jobber customer with that id — re-check it with jobber_find_customer."
    const jobs = client.jobs?.nodes ?? []
    if (jobs.length === 0) return `${client.name || 'That customer'} has no jobs in Jobber.`

    return lines(
      `${client.name || 'Customer'} — ${jobs.length} job${jobs.length === 1 ? '' : 's'} in Jobber:`,
      ...jobs.map((j) => {
        const next = j.visits?.nodes?.[0]
        return lines(
          `• #${j.jobNumber ?? '?'} ${j.title || '(untitled)'} — ${j.jobStatus || 'unknown status'}` +
            `${j.total != null ? ` · ${formatCurrency(Number(j.total))}` : ''} · job id ${j.id}`,
          next?.startAt ? `  next visit ${stampLabel(next.startAt)} · visit id ${next.id}` : null,
        )
      }),
    )
  },
}

const VISITS_BY_DATE = `
  query HubAssistantVisits($filter: VisitFilterAttributes) {
    visits(first: 50, filter: $filter) {
      nodes {
        id
        title
        startAt
        endAt
        isComplete
        job { id jobNumber title client { id name } }
        assignedUsers(first: 10) { nodes { id name { first last } } }
      }
    }
  }
`

export const jobberGetVisitsAction: HubAction = {
  name: 'jobber_get_visits',
  description:
    'Visits from Jobber LIVE for a date, with who is assigned and whether each is complete. Use this ' +
    'when you need visit ids to reschedule or reassign, or when the local schedule might be stale. For ' +
    'a plain "what\'s on today" question prefer get_schedule.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '"today", "tomorrow", "yesterday", or YYYY-MM-DD.' },
      limit: { type: 'number', description: 'Max visits (default 25, max 50).' },
    },
    required: ['date'],
  },
  kind: 'read',
  gate: null,
  group: 'jobber',
  consentLabel: 'see scheduled visits in Jobber',
  run: async (ctx, args) => {
    const day = resolveDateArg(str(args, 'date'))
    if (!day) return 'I need a specific day: "today", "tomorrow", "yesterday", or YYYY-MM-DD.'
    const limit = limitArg(args, 25, 50)
    const ju = await jobberUser(ctx)
    if (!ju.ok) return ju.message

    const resp = await jobberGraphQLAdmin<{
      data?: {
        visits?: {
          nodes?: Array<{
            id: string
            title: string | null
            startAt: string | null
            isComplete: boolean | null
            job?: { jobNumber: number | null; title: string | null; client?: { name: string | null } | null } | null
            assignedUsers?: { nodes?: Array<{ name?: { first: string | null; last: string | null } | null }> }
          }>
        }
      }
    }>(ju.userId, VISITS_BY_DATE, {
      filter: { startAt: { after: `${day}T00:00:00Z`, before: `${day}T23:59:59Z` } },
    })

    const visits = (resp.data?.visits?.nodes ?? []).slice(0, limit)
    if (visits.length === 0) return `Jobber shows no visits on ${day}.`

    return lines(
      `${visits.length} visit${visits.length === 1 ? '' : 's'} in Jobber on ${day}:`,
      ...visits.map((v) => {
        const crew =
          (v.assignedUsers?.nodes ?? [])
            .map((u) => `${u.name?.first ?? ''} ${u.name?.last ?? ''}`.trim())
            .filter(Boolean)
            .join(', ') || 'Unassigned'
        return lines(
          `• ${v.job?.client?.name || 'Unknown customer'} — ${v.title || v.job?.title || '(untitled)'}` +
            `${v.isComplete ? ' [done]' : ''}`,
          `  ${v.startAt ? stampLabel(v.startAt) : 'no time'} · crew: ${crew} · visit id ${v.id}`,
        )
      }),
    )
  },
}

const MONEY_DOCS = `
  query HubAssistantMoney($quoteFilter: QuoteFilterAttributes, $invoiceFilter: InvoiceFilterAttributes) {
    quotes(first: 20, filter: $quoteFilter) {
      nodes { id quoteNumber quoteStatus amounts { total } client { name } }
    }
    invoices(first: 20, filter: $invoiceFilter) {
      nodes { id invoiceNumber invoiceStatus amounts { total invoiceBalance } client { name } dueDate }
    }
  }
`

export const jobberMoneyAction: HubAction = {
  name: 'jobber_list_quotes_and_invoices',
  description:
    'Outstanding quotes and unpaid invoices from Jobber. Use this for "what quotes are still open?" or ' +
    '"who owes us money?". Read-only. Never state a balance to a customer — this is internal.',
  input_schema: {
    type: 'object',
    properties: {
      show: {
        type: 'string',
        enum: ['both', 'quotes', 'invoices'],
        description: 'Which to list. Defaults to both.',
      },
    },
    required: [],
  },
  kind: 'read',
  gate: null,
  group: 'jobber',
  consentLabel: 'see open quotes and unpaid invoices',
  run: async (ctx, args) => {
    const show = str(args, 'show').toLowerCase()
    const ju = await jobberUser(ctx)
    if (!ju.ok) return ju.message

    const resp = await jobberGraphQLAdmin<{
      data?: {
        quotes?: {
          nodes?: Array<{
            quoteNumber: string | null
            quoteStatus: string | null
            amounts?: { total: number | null } | null
            client?: { name: string | null } | null
          }>
        }
        invoices?: {
          nodes?: Array<{
            invoiceNumber: number | null
            invoiceStatus: string | null
            dueDate: string | null
            amounts?: { total: number | null; invoiceBalance: number | null } | null
            client?: { name: string | null } | null
          }>
        }
      }
    }>(ju.userId, MONEY_DOCS, { quoteFilter: {}, invoiceFilter: {} })

    const out: string[] = []

    if (show !== 'invoices') {
      const quotes = (resp.data?.quotes?.nodes ?? []).filter(
        (q) => (q.quoteStatus || '').toUpperCase() !== 'CONVERTED',
      )
      out.push(
        quotes.length
          ? lines(
              `Quotes (${quotes.length}):`,
              ...quotes.map(
                (q) =>
                  `• #${q.quoteNumber ?? '?'} ${q.client?.name || 'Unknown'} — ${q.quoteStatus || 'unknown'}` +
                  `${q.amounts?.total != null ? ` · ${formatCurrency(Number(q.amounts.total))}` : ''}`,
              ),
            )
          : 'No open quotes in Jobber.',
      )
    }

    if (show !== 'quotes') {
      const unpaid = (resp.data?.invoices?.nodes ?? []).filter(
        (i) => Number(i.amounts?.invoiceBalance ?? 0) > 0,
      )
      out.push(
        unpaid.length
          ? lines(
              `Unpaid invoices (${unpaid.length}):`,
              ...unpaid.map(
                (i) =>
                  `• #${i.invoiceNumber ?? '?'} ${i.client?.name || 'Unknown'} — owing ` +
                  `${formatCurrency(Number(i.amounts?.invoiceBalance ?? 0))}` +
                  `${i.dueDate ? ` · due ${i.dueDate}` : ''} · ${i.invoiceStatus || ''}`.trimEnd(),
              ),
            )
          : 'No unpaid invoices in Jobber.',
      )
    }

    return out.join('\n\n')
  },
}

// ── Writes: notes (no confirmation — additive and reversible) ────────────────

const CREATE_CLIENT_NOTE = `
  mutation HubAssistantClientNote($clientId: EncodedId!, $input: ClientCreateNoteInput!) {
    clientCreateNote(clientId: $clientId, input: $input) {
      clientNote { id }
      userErrors { message }
    }
  }
`

const CREATE_JOB_NOTE = `
  mutation HubAssistantJobNote($jobId: EncodedId!, $input: JobCreateNoteInput!) {
    jobCreateNote(jobId: $jobId, input: $input) {
      jobNote { id }
      userErrors { message }
    }
  }
`

export const jobberAddNoteAction: HubAction = {
  name: 'jobber_add_note',
  description:
    'Add a note in Jobber, on either a customer or a specific job. Use this to record what a customer ' +
    'asked for or what was promised, so the crew and office see it in Jobber itself. Give exactly one ' +
    'of client_id or job_id.',
  input_schema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'Jobber client id, to note on the customer.' },
      job_id: { type: 'string', description: 'Jobber job id, to note on that job.' },
      note: { type: 'string', description: 'The note text.' },
    },
    required: ['note'],
  },
  kind: 'write',
  gate: JOBBER_WRITE_GATE,
  group: 'jobber',
  defaultOn: false,
  consentLabel: 'add notes in Jobber',
  run: async (ctx, args) => {
    const clientId = str(args, 'client_id')
    const jobId = str(args, 'job_id')
    const note = str(args, 'note')
    if (!note) return 'Provide the note text.'
    if (note.length > 2000) return 'That note is too long — keep it under about 2000 characters.'
    if (!clientId && !jobId) return 'Say whether this note goes on the customer (client_id) or a job (job_id).'
    if (clientId && jobId) return 'Give only one of client_id or job_id, not both.'

    const ju = await jobberUser(ctx)
    if (!ju.ok) return ju.message

    // Stamp who asked, so a Jobber-side reader knows it came through the assistant.
    const body = `${note}\n\n— added by ${ctx.actor.displayName} via the Lynxedo assistant`

    if (clientId) {
      const resp = await jobberGraphQLAdmin<{
        data?: { clientCreateNote?: { clientNote?: { id: string } | null; userErrors?: Array<{ message: string }> } }
      }>(ju.userId, CREATE_CLIENT_NOTE, {
        clientId,
        input: {
          message: body,
          // REQUIRED. Without it Jobber attaches the note to every related job,
          // invoice, quote and request — see the file header.
          linkedTo: { invoices: false, jobs: false, quotes: false, requests: false },
        },
      })
      const err = userErrorText(resp.data?.clientCreateNote?.userErrors)
      if (err) return `Jobber refused that note: ${err}`
      if (!resp.data?.clientCreateNote?.clientNote?.id) return "The note didn't save — nothing was added."
      return 'Note added to the customer in Jobber.'
    }

    const resp = await jobberGraphQLAdmin<{
      data?: { jobCreateNote?: { jobNote?: { id: string } | null; userErrors?: Array<{ message: string }> } }
    }>(ju.userId, CREATE_JOB_NOTE, { jobId, input: { message: body } })
    const err = userErrorText(resp.data?.jobCreateNote?.userErrors)
    if (err) return `Jobber refused that note: ${err}`
    if (!resp.data?.jobCreateNote?.jobNote?.id) return "The note didn't save — nothing was added."
    return 'Note added to the job in Jobber.'
  },
}

// ── Writes: schedule changes (confirmed) ─────────────────────────────────────

// ⚠ Fetch a single visit via the `ids` filter, NOT Relay-style `node(id:)` —
// Jobber's schema has no `node` root field (verified: the working MCP server never
// uses one, and VisitFilterAttributes exposes `ids` for exactly this).
const VISIT_LOOKUP = `
  query HubAssistantVisit($visitId: EncodedId!) {
    visits(first: 1, filter: { ids: [$visitId] }) {
      nodes {
        id
        title
        startAt
        endAt
        isComplete
        job { jobNumber title client { name } }
        assignedUsers(first: 10) { nodes { id name { first last } } }
      }
    }
  }
`

type VisitLookup = {
  id: string
  title: string | null
  startAt: string | null
  isComplete: boolean | null
  job?: { jobNumber: number | null; title: string | null; client?: { name: string | null } | null } | null
  assignedUsers?: { nodes?: Array<{ id: string; name?: { first: string | null; last: string | null } | null }> }
}

async function loadVisit(
  ctx: ActionContext,
  visitId: string,
): Promise<{ ok: true; userId: string; visit: VisitLookup } | { ok: false; message: string }> {
  const ju = await jobberUser(ctx)
  if (!ju.ok) return ju
  const resp = await jobberGraphQLAdmin<{ data?: { visits?: { nodes?: VisitLookup[] } } }>(
    ju.userId,
    VISIT_LOOKUP,
    { visitId },
  )
  const visit = resp.data?.visits?.nodes?.[0]
  if (!visit?.id) {
    return { ok: false, message: "That visit id isn't in Jobber — find it with jobber_get_visits first." }
  }
  return { ok: true, userId: ju.userId, visit }
}

function visitLabel(v: VisitLookup): string {
  const who = v.job?.client?.name || 'Unknown customer'
  const what = v.title || v.job?.title || 'visit'
  return `${who} — ${what}`
}

const VISIT_EDIT_SCHEDULE = `
  mutation HubAssistantReschedule($id: EncodedId!, $input: VisitEditScheduleInput!) {
    visitEditSchedule(id: $id, input: $input) {
      visit { id startAt endAt }
      userErrors { message }
    }
  }
`

export const jobberRescheduleVisitAction: HubAction = {
  name: 'jobber_reschedule_visit',
  description:
    'Move a scheduled visit to a different day (and optionally time) in Jobber. This changes the real ' +
    'schedule a crew works from, so it PREVIEWS first and needs the person to approve before anything ' +
    'moves. Get the visit id from jobber_get_visits. Never guess a visit id.',
  input_schema: {
    type: 'object',
    properties: {
      visit_id: { type: 'string', description: 'Jobber visit id from jobber_get_visits.' },
      date: { type: 'string', description: 'New date: "today", "tomorrow", or YYYY-MM-DD.' },
      start_time: { type: 'string', description: 'Optional new start time, HH:MM 24-hour.' },
      end_time: { type: 'string', description: 'Optional new end time, HH:MM 24-hour.' },
    },
    required: ['visit_id', 'date'],
  },
  kind: 'jobber_write',
  gate: JOBBER_WRITE_GATE,
  group: 'jobber',
  defaultOn: false,
  consentLabel: 'reschedule visits in Jobber (with your confirmation)',
  run: async (ctx, args) => {
    const resolved = await resolveReschedule(ctx, args)
    if (!resolved.ok) return resolved.message
    const { userId, visit, date, startTime, endTime } = resolved

    const input: Record<string, unknown> = { startAt: localDateTime(date, startTime) }
    if (endTime) input.endAt = localDateTime(date, endTime)

    const resp = await jobberGraphQLAdmin<{
      data?: { visitEditSchedule?: { visit?: { id: string } | null; userErrors?: Array<{ message: string }> } }
    }>(userId, VISIT_EDIT_SCHEDULE, { id: visit.id, input })

    const err = userErrorText(resp.data?.visitEditSchedule?.userErrors)
    if (err) return `Jobber refused the reschedule: ${err}. Nothing moved.`
    if (!resp.data?.visitEditSchedule?.visit?.id) return "The reschedule didn't take — nothing moved."

    return `Moved. ${visitLabel(visit)} is now on ${date}${startTime ? ` at ${startTime}` : ''} in Jobber.`
  },
}

async function resolveReschedule(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; userId: string; visit: VisitLookup; date: string; startTime: string; endTime: string }
  | { ok: false; message: string }
> {
  const visitId = str(args, 'visit_id')
  if (!visitId) return { ok: false, message: 'Provide a visit_id from jobber_get_visits.' }
  const date = resolveDateArg(str(args, 'date'))
  if (!date) return { ok: false, message: 'I need a specific new date: "tomorrow" or YYYY-MM-DD.' }

  const startTime = str(args, 'start_time')
  const endTime = str(args, 'end_time')
  if (startTime && !HHMM_RE.test(startTime)) {
    return { ok: false, message: 'start_time must be HH:MM on a 24-hour clock, e.g. 14:30.' }
  }
  if (endTime && !HHMM_RE.test(endTime)) {
    return { ok: false, message: 'end_time must be HH:MM on a 24-hour clock, e.g. 16:00.' }
  }

  const loaded = await loadVisit(ctx, visitId)
  if (!loaded.ok) return loaded
  if (loaded.visit.isComplete) {
    return { ok: false, message: 'That visit is already marked complete, so rescheduling it would be wrong. Nothing changed.' }
  }
  return { ok: true, userId: loaded.userId, visit: loaded.visit, date, startTime, endTime }
}

/** Preview for a reschedule — names the customer and both dates so it's checkable. */
export async function previewJobberReschedule(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<{ ok: true; preview: string } | { ok: false; message: string }> {
  const resolved = await resolveReschedule(ctx, args)
  if (!resolved.ok) return { ok: false, message: resolved.message }
  const { visit, date, startTime } = resolved
  return {
    ok: true,
    preview: lines(
      `  Visit: ${visitLabel(visit)}`,
      `  Currently: ${visit.startAt ? stampLabel(visit.startAt) : 'unscheduled'}`,
      `  Moving to: ${date}${startTime ? ` at ${startTime}` : ' (time unchanged)'}`,
      '  This changes the real Jobber schedule the crew works from.',
    ),
  }
}

const VISIT_EDIT_ASSIGNED = `
  mutation HubAssistantAssign($visitId: EncodedId!, $input: VisitEditAssignedUsersInput!) {
    visitEditAssignedUsers(visitId: $visitId, input: $input) {
      visit { id }
      userErrors { message }
    }
  }
`

const JOBBER_TEAM = `
  query HubAssistantTeam { users(first: 100) { nodes { id name { first last } } } }
`

type JobberTeamMember = { id: string; name?: { first: string | null; last: string | null } | null }

function memberLabel(u: JobberTeamMember): string {
  return `${u.name?.first ?? ''} ${u.name?.last ?? ''}`.trim() || u.id
}

/**
 * Turn model-supplied crew NAMES into Jobber team member ids, refusing anything
 * ambiguous. Names rather than ids because a model that guesses at an EncodedId
 * assigns the wrong person silently, whereas a wrong name fails loudly right here.
 *
 * An empty list is only an error when the caller says so — actions where "nobody
 * named" legitimately means "leave the crew alone" pass required: false.
 */
async function matchTeamMembers(
  userId: string,
  namesRaw: unknown,
  required = true,
): Promise<{ ok: true; members: JobberTeamMember[] } | { ok: false; message: string }> {
  const names = Array.isArray(namesRaw)
    ? namesRaw.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    : typeof namesRaw === 'string' && namesRaw.trim()
      ? [namesRaw]
      : []
  if (names.length === 0) {
    return required
      ? { ok: false, message: 'Say who to assign — one or more team member names.' }
      : { ok: true, members: [] }
  }

  const teamResp = await jobberGraphQLAdmin<{ data?: { users?: { nodes?: JobberTeamMember[] } } }>(
    userId,
    JOBBER_TEAM,
    {},
  )
  const team = teamResp.data?.users?.nodes ?? []

  const matched: JobberTeamMember[] = []
  for (const wanted of names) {
    const needle = wanted.trim().toLowerCase()
    const hits = team.filter((u) => memberLabel(u).toLowerCase().includes(needle))
    if (hits.length === 0) {
      return {
        ok: false,
        message: `No Jobber team member matches "${wanted}". The team is: ${team.map(memberLabel).join(', ')}.`,
      }
    }
    if (hits.length > 1) {
      return { ok: false, message: `"${wanted}" matches ${hits.map(memberLabel).join(', ')}. Ask which one.` }
    }
    if (!matched.some((m) => m.id === hits[0].id)) matched.push(hits[0])
  }

  return { ok: true, members: matched }
}

async function resolveAssign(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; userId: string; visit: VisitLookup; members: JobberTeamMember[] }
  | { ok: false; message: string }
> {
  const visitId = str(args, 'visit_id')
  if (!visitId) return { ok: false, message: 'Provide a visit_id from jobber_get_visits.' }

  const loaded = await loadVisit(ctx, visitId)
  if (!loaded.ok) return loaded

  const crew = await matchTeamMembers(loaded.userId, args.assign_to)
  if (!crew.ok) return crew

  return { ok: true, userId: loaded.userId, visit: loaded.visit, members: crew.members }
}

export const jobberAssignVisitAction: HubAction = {
  name: 'jobber_assign_visit',
  description:
    'Change who is assigned to a Jobber visit, by team member name. This REPLACES the current crew ' +
    'rather than adding to it, so include everyone who should be on it. Previews first and needs ' +
    'approval. Get the visit id from jobber_get_visits.',
  input_schema: {
    type: 'object',
    properties: {
      visit_id: { type: 'string', description: 'Jobber visit id from jobber_get_visits.' },
      assign_to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Team member names who should be on this visit. Replaces the existing crew.',
      },
    },
    required: ['visit_id', 'assign_to'],
  },
  kind: 'jobber_write',
  gate: JOBBER_WRITE_GATE,
  group: 'jobber',
  defaultOn: false,
  consentLabel: 'change who is assigned to visits (with your confirmation)',
  run: async (ctx, args) => {
    const resolved = await resolveAssign(ctx, args)
    if (!resolved.ok) return resolved.message
    const { userId, visit, members } = resolved

    const resp = await jobberGraphQLAdmin<{
      data?: { visitEditAssignedUsers?: { visit?: { id: string } | null; userErrors?: Array<{ message: string }> } }
    }>(userId, VISIT_EDIT_ASSIGNED, {
      visitId: visit.id,
      input: { assignedUserIds: members.map((m) => m.id) },
    })

    const err = userErrorText(resp.data?.visitEditAssignedUsers?.userErrors)
    if (err) return `Jobber refused that change: ${err}. The crew is unchanged.`
    if (!resp.data?.visitEditAssignedUsers?.visit?.id) return "That didn't take — the crew is unchanged."

    return `Done. ${visitLabel(visit)} is now assigned to ${members.map(memberLabel).join(', ')}.`
  },
}

export async function previewJobberAssign(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<{ ok: true; preview: string } | { ok: false; message: string }> {
  const resolved = await resolveAssign(ctx, args)
  if (!resolved.ok) return { ok: false, message: resolved.message }
  const { visit, members } = resolved
  const current =
    (visit.assignedUsers?.nodes ?? []).map(memberLabel).filter(Boolean).join(', ') || 'nobody'
  return {
    ok: true,
    preview: lines(
      `  Visit: ${visitLabel(visit)}${visit.startAt ? ` on ${stampLabel(visit.startAt)}` : ''}`,
      `  Currently assigned: ${current}`,
      `  Changing to: ${members.map(memberLabel).join(', ')}`,
      '  This replaces the crew on the real Jobber visit.',
    ),
  }
}

const VISIT_COMPLETE = `
  mutation HubAssistantComplete($visitId: EncodedId!) {
    visitComplete(visitId: $visitId) {
      visit { id isComplete }
      userErrors { message }
    }
  }
`

export const jobberCompleteVisitAction: HubAction = {
  name: 'jobber_complete_visit',
  description:
    'Mark a Jobber visit complete. This can start the billing side of things, so it previews first and ' +
    'needs approval. Only use it when the user clearly says the work is finished.',
  input_schema: {
    type: 'object',
    properties: { visit_id: { type: 'string', description: 'Jobber visit id from jobber_get_visits.' } },
    required: ['visit_id'],
  },
  kind: 'jobber_write',
  gate: JOBBER_WRITE_GATE,
  group: 'jobber',
  defaultOn: false,
  consentLabel: 'mark visits complete in Jobber (with your confirmation)',
  run: async (ctx, args) => {
    const visitId = str(args, 'visit_id')
    if (!visitId) return 'Provide a visit_id from jobber_get_visits.'
    const loaded = await loadVisit(ctx, visitId)
    if (!loaded.ok) return loaded.message
    if (loaded.visit.isComplete) return 'That visit was already marked complete — nothing changed.'

    const resp = await jobberGraphQLAdmin<{
      data?: { visitComplete?: { visit?: { id: string; isComplete: boolean } | null; userErrors?: Array<{ message: string }> } }
    }>(loaded.userId, VISIT_COMPLETE, { visitId: loaded.visit.id })

    const err = userErrorText(resp.data?.visitComplete?.userErrors)
    if (err) return `Jobber refused that: ${err}. The visit is unchanged.`
    if (!resp.data?.visitComplete?.visit?.isComplete) return "That didn't take — the visit is unchanged."

    return `Marked complete: ${visitLabel(loaded.visit)}.`
  },
}

export async function previewJobberComplete(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<{ ok: true; preview: string } | { ok: false; message: string }> {
  const visitId = str(args, 'visit_id')
  if (!visitId) return { ok: false, message: 'Provide a visit_id from jobber_get_visits.' }
  const loaded = await loadVisit(ctx, visitId)
  if (!loaded.ok) return { ok: false, message: loaded.message }
  if (loaded.visit.isComplete) {
    return { ok: false, message: 'That visit is already complete — nothing to do.' }
  }
  return {
    ok: true,
    preview: lines(
      `  Visit: ${visitLabel(loaded.visit)}`,
      `  Scheduled: ${loaded.visit.startAt ? stampLabel(loaded.visit.startAt) : 'unscheduled'}`,
      '  Marking it complete in Jobber. This can begin the invoicing side of things.',
    ),
  }
}

// ── Writes: putting work ON the schedule (confirmed) ─────────────────────────
//
// WHY THESE EXIST. The Aug 2026 shadow rule (lib/guardian-permissions.ts)
// withheld the legacy `schedule_visit` and `update_job_schedule` tools on the
// stated grounds that `jobber_reschedule_visit` owned the capability. It did not:
// reschedule, assign and complete all operate on a visit that ALREADY EXISTS, so
// after the shadow there was no door at all to CREATE a visit or SET a recurrence.
// Setting up a job dead-ended at a job with nothing on the calendar. These two
// restore exactly that capability, this time through the gates, the confirmation
// step and the meter.
//
// ⚠ SCOPE, deliberately narrow. `jobber_set_recurring_schedule` only puts a
// schedule on a job that has NO open visits yet. Changing the recurrence of a
// live series is a different and much harder operation — the working
// implementation in `Jobber MCP/server.js` needs a no-op guard, a scratch-rule
// bounce (Jobber silently generates nothing when the stored rule already equals
// the target), a delete-and-confirm loop and an async settle wait, because a
// naive edit orphans or duplicates real visits. That belongs in Jobber's own UI,
// not in a chat turn, so this refuses rather than half-implements it.

const JOB_SCHEDULE_LOOKUP = `
  query HubAssistantJobSchedule($jobId: EncodedId!) {
    job(id: $jobId) {
      id
      jobNumber
      title
      jobStatus
      client { name }
      visitSchedule {
        startDate
        endDate
        recurrenceSchedule { friendly calendarRule }
      }
      visits(first: 50) { nodes { id startAt isComplete } }
    }
  }
`

type JobLookup = {
  id: string
  jobNumber: number | null
  title: string | null
  jobStatus: string | null
  client?: { name: string | null } | null
  visitSchedule?: {
    startDate: string | null
    endDate: string | null
    recurrenceSchedule?: { friendly: string | null; calendarRule: string | null } | null
  } | null
  visits?: { nodes?: Array<{ id: string; startAt: string | null; isComplete: boolean | null }> }
}

async function loadJob(
  ctx: ActionContext,
  jobId: string,
): Promise<{ ok: true; userId: string; job: JobLookup } | { ok: false; message: string }> {
  const ju = await jobberUser(ctx)
  if (!ju.ok) return ju
  const resp = await jobberGraphQLAdmin<{ data?: { job?: JobLookup | null } }>(ju.userId, JOB_SCHEDULE_LOOKUP, {
    jobId,
  })
  const job = resp.data?.job
  if (!job?.id) {
    return {
      ok: false,
      message:
        "That job id isn't in Jobber. Note it needs the long encoded id, not the job NUMBER — get it from " +
        'jobber_get_customer_jobs. Never guess one.',
    }
  }
  return { ok: true, userId: ju.userId, job }
}

function jobLabel(j: JobLookup): string {
  return `${j.client?.name || 'Unknown customer'} — #${j.jobNumber ?? '?'} ${j.title || '(untitled)'}`
}

/** Visits on the job that aren't finished — the ones a schedule change would disturb. */
function openVisits(j: JobLookup): Array<{ id: string; startAt: string | null }> {
  return (j.visits?.nodes ?? []).filter((v) => !v.isComplete)
}

const VISIT_CREATE = `
  mutation HubAssistantVisitCreate($jobId: EncodedId!, $input: VisitCreateInput!) {
    visitCreate(jobId: $jobId, input: $input) {
      createdVisits { id startAt }
      userErrors { message }
    }
  }
`

type ResolvedVisitCreate = {
  ok: true
  userId: string
  job: JobLookup
  date: string
  startTime: string
  endTime: string
  members: JobberTeamMember[]
}

async function resolveScheduleVisit(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<ResolvedVisitCreate | { ok: false; message: string }> {
  const jobId = str(args, 'job_id')
  if (!jobId) return { ok: false, message: 'Provide a job_id from jobber_get_customer_jobs.' }

  const rawDate = str(args, 'date')
  let date = ''
  if (rawDate && rawDate.toLowerCase() !== 'unscheduled') {
    const resolved = resolveDateArg(rawDate)
    if (!resolved) {
      return {
        ok: false,
        message: 'I need a specific date ("today", "tomorrow", YYYY-MM-DD), or leave it out to create an unscheduled visit.',
      }
    }
    date = resolved
  }

  const startTime = str(args, 'start_time')
  const endTime = str(args, 'end_time')
  if (startTime && !HHMM_RE.test(startTime)) {
    return { ok: false, message: 'start_time must be HH:MM on a 24-hour clock, e.g. 14:30.' }
  }
  if (endTime && !HHMM_RE.test(endTime)) {
    return { ok: false, message: 'end_time must be HH:MM on a 24-hour clock, e.g. 16:00.' }
  }
  if (!date && (startTime || endTime)) {
    return { ok: false, message: "A time needs a date. Give the date too, or drop the time and I'll leave the visit unscheduled." }
  }

  const loaded = await loadJob(ctx, jobId)
  if (!loaded.ok) return loaded

  const crew = await matchTeamMembers(loaded.userId, args.assign_to, false)
  if (!crew.ok) return crew

  return { ok: true, userId: loaded.userId, job: loaded.job, date, startTime, endTime, members: crew.members }
}

/** How the visit's timing reads in a preview or a result. */
function visitTimingLabel(date: string, startTime: string, endTime: string): string {
  if (!date) return 'unscheduled — it lands in the Unscheduled bucket for the office to place'
  const when = `${dayLabel(date)} (${date})`
  if (!startTime) return `${when}, Anytime`
  return `${when}, ${startTime}${endTime ? `–${endTime}` : ''}`
}

export const jobberScheduleVisitAction: HubAction = {
  name: 'jobber_schedule_visit',
  description:
    'Put a NEW visit on an existing Jobber job — either on a specific day, or unscheduled so the office ' +
    'can place it. Use this after creating a job, or to add an extra visit to one. To move a visit that ' +
    'already exists use jobber_reschedule_visit instead. ' +
    'Leave start_time and end_time out unless a specific arrival time was actually promised: the ' +
    'default is an Anytime visit, and that is almost always what is wanted. Leave the date out entirely ' +
    'for an unscheduled visit. Get the job id from jobber_get_customer_jobs — it is the long encoded id, ' +
    'never the job number. Previews first and needs approval.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'Jobber job id (encoded id) from jobber_get_customer_jobs.' },
      date: {
        type: 'string',
        description: 'Day for the visit: "today", "tomorrow", or YYYY-MM-DD. Omit for an unscheduled visit.',
      },
      start_time: { type: 'string', description: 'Optional start time, HH:MM 24-hour. Omit for an Anytime visit.' },
      end_time: { type: 'string', description: 'Optional end time, HH:MM 24-hour.' },
      assign_to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional crew, by team member name. Omit to leave the visit unassigned.',
      },
    },
    required: ['job_id'],
  },
  kind: 'jobber_write',
  gate: JOBBER_WRITE_GATE,
  group: 'jobber',
  defaultOn: false,
  consentLabel: 'add visits to jobs in Jobber (with your confirmation)',
  run: async (ctx, args) => {
    const resolved = await resolveScheduleVisit(ctx, args)
    if (!resolved.ok) return resolved.message
    const { userId, job, date, startTime, endTime, members } = resolved

    const schedule: Record<string, unknown> = {}
    if (date) {
      schedule.startAt = localDateTime(date, startTime)
      if (endTime) schedule.endAt = localDateTime(date, endTime)
    }
    if (members.length) schedule.teamMemberIdsToAssign = members.map((m) => m.id)

    // An empty visit attribute object is legitimate — that's how an unassigned,
    // undated visit gets created — so only send `schedule` when it has content.
    const visitAttrs = Object.keys(schedule).length ? { schedule } : {}

    const resp = await jobberGraphQLAdmin<{
      data?: {
        visitCreate?: {
          createdVisits?: Array<{ id: string; startAt: string | null }>
          userErrors?: Array<{ message: string }>
        }
      }
    }>(userId, VISIT_CREATE, { jobId: job.id, input: { visits: [visitAttrs] } })

    const err = userErrorText(resp.data?.visitCreate?.userErrors)
    if (err) return `Jobber refused that visit: ${err}. Nothing was added.`
    const created = resp.data?.visitCreate?.createdVisits?.[0]
    if (!created?.id) return "The visit didn't save — nothing was added to the job."

    return lines(
      `Added a visit to ${jobLabel(job)}.`,
      `  ${visitTimingLabel(date, startTime, endTime)}`,
      `  Crew: ${members.length ? members.map(memberLabel).join(', ') : 'unassigned'}`,
      `  Visit id ${created.id}`,
    )
  },
}

export async function previewJobberScheduleVisit(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<{ ok: true; preview: string } | { ok: false; message: string }> {
  const resolved = await resolveScheduleVisit(ctx, args)
  if (!resolved.ok) return { ok: false, message: resolved.message }
  const { job, date, startTime, endTime, members } = resolved
  const existing = openVisits(job).length
  return {
    ok: true,
    preview: lines(
      `  Job: ${jobLabel(job)}`,
      `  Adding a visit: ${visitTimingLabel(date, startTime, endTime)}`,
      `  Crew: ${members.length ? members.map(memberLabel).join(', ') : 'unassigned'}`,
      existing ? `  This job already has ${existing} unfinished visit${existing === 1 ? '' : 's'} — this ADDS to them.` : null,
      '  This creates a real visit on the Jobber schedule.',
    ),
  }
}

// -- Recurring schedules ------------------------------------------------------

const JOB_EDIT_SCHEDULE = `
  mutation HubAssistantJobEditSchedule($jobId: EncodedId!, $input: JobEditInput!) {
    jobEdit(jobId: $jobId, input: $input) {
      job {
        id
        jobNumber
        visitSchedule {
          startDate
          endDate
          recurrenceSchedule { friendly calendarRule }
        }
      }
      userErrors { message }
    }
  }
`

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * Ceiling on how many dates a rule is expanded to for the preview. Far above any
 * real schedule (a monthly job over three years is 36), so hitting it means the
 * rule is denser than anything Heroes runs — the count is then reported as "N+"
 * rather than as if it were exact.
 */
const EXPAND_CAP = 400

/** "36" or "400+" — never a capped number presented as a total. */
function countLabel(dates: string[]): string {
  return `${dates.length}${dates.length >= EXPAND_CAP ? '+' : ''}`
}

function ymdFromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Compare two recurrence rules ignoring part order, case, and the RRULE: prefix. */
function normalizeRule(rule: string | null | undefined): string {
  if (!rule) return ''
  return rule
    .toUpperCase()
    .replace(/^RRULE:/, '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .sort()
    .join(';')
}

/** The date of the nth (1-4, or negative for "from the end") weekday of a month. */
function nthWeekdayOfMonth(year: number, month0: number, n: number, weekday: number): string | null {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay()
  const lastDate = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  let day: number
  if (n > 0) {
    day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7
  } else {
    const lastDow = new Date(Date.UTC(year, month0, lastDate)).getUTCDay()
    day = lastDate - ((lastDow - weekday + 7) % 7) + (n + 1) * 7
  }
  if (day < 1 || day > lastDate) return null
  return ymdFromUtc(Date.UTC(year, month0, day))
}

/**
 * Expand the recurrence rules Heroes actually uses so a preview can show REAL
 * DATES rather than an RRULE string nobody can eyeball. A wrong rule is the
 * quietest possible mistake — a truck simply turns up on the wrong day for three
 * years — and "2nd Tuesday" vs "2nd Thursday" is obvious in dates and invisible
 * in `BYDAY=2TU`. Returns null for anything not understood; the caller then shows
 * the raw rule and says plainly that it couldn't be expanded.
 */
function expandRecurrence(rule: string, startDate: string, endDate: string): string[] | null {
  const parts = new Map<string, string>()
  for (const p of rule.toUpperCase().replace(/^RRULE:/, '').split(';')) {
    const [k, v] = p.split('=')
    if (k && v) parts.set(k.trim(), v.trim())
  }
  const freq = parts.get('FREQ')
  const interval = Math.max(1, Number(parts.get('INTERVAL') || '1'))
  const out: string[] = []
  const MAX = EXPAND_CAP

  if (freq === 'DAILY' || freq === 'WEEKLY') {
    const step = interval * (freq === 'WEEKLY' ? 7 : 1)
    let d = startDate
    while (d <= endDate && out.length < MAX) {
      out.push(d)
      d = addDays(d, step)
    }
    return out
  }

  if (freq === 'MONTHLY') {
    const byDay = parts.get('BYDAY')
    const byMonthDay = parts.get('BYMONTHDAY')
    const [sy, sm] = startDate.split('-').map(Number)
    let year = sy
    let month0 = sm - 1

    const m = byDay ? /^(-?\d)(SU|MO|TU|WE|TH|FR|SA)$/.exec(byDay) : null
    if (byDay && !m) return null
    const nth = m ? Number(m[1]) : 0
    const weekday = m ? WEEKDAY_CODES.indexOf(m[2]) : 0
    const domTarget = byMonthDay ? Number(byMonthDay) : Number(startDate.slice(8, 10))
    if (!m && byMonthDay && (!Number.isFinite(domTarget) || domTarget < 1 || domTarget > 31)) return null

    for (let i = 0; i < MAX; i++) {
      let candidate: string | null
      if (m) {
        candidate = nthWeekdayOfMonth(year, month0, nth, weekday)
      } else {
        const lastDate = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
        candidate = domTarget > lastDate ? null : ymdFromUtc(Date.UTC(year, month0, domTarget))
      }
      if (candidate && candidate >= startDate) {
        if (candidate > endDate) break
        out.push(candidate)
      }
      month0 += 1
      if (month0 > 11) {
        month0 = 0
        year += 1
      }
      // Guard against a rule that can never land (e.g. a 5th Friday every month).
      if (out.length === 0 && i > 24) return null
    }
    return out
  }

  return null
}

type ResolvedRecurring = {
  ok: true
  userId: string
  job: JobLookup
  recurrence: string
  startDate: string
  endDate: string
  members: JobberTeamMember[]
  dates: string[] | null
}

async function resolveRecurring(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<ResolvedRecurring | { ok: false; message: string }> {
  const jobId = str(args, 'job_id')
  if (!jobId) return { ok: false, message: 'Provide a job_id from jobber_get_customer_jobs.' }

  const recurrence = str(args, 'recurrence').toUpperCase()
  if (!recurrence.startsWith('RRULE:')) {
    return {
      ok: false,
      message:
        'recurrence must be an iCal rule starting with "RRULE:" — e.g. "RRULE:FREQ=MONTHLY;BYDAY=2TU" for the ' +
        'second Tuesday of each month, or "RRULE:FREQ=DAILY;INTERVAL=46" for every 46 days.',
    }
  }

  const startDate = resolveDateArg(str(args, 'start_date'))
  if (!startDate) {
    return { ok: false, message: 'I need the first date this job should run, as YYYY-MM-DD. Never guess it — ask.' }
  }

  const rawEnd = str(args, 'end_date')
  let endDate: string
  if (rawEnd) {
    const resolved = resolveDateArg(rawEnd)
    if (!resolved) return { ok: false, message: 'end_date must be YYYY-MM-DD.' }
    endDate = resolved
  } else {
    // House convention: recurring jobs run three years out.
    const [y, m, d] = startDate.split('-').map(Number)
    endDate = `${y + 3}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (!YMD_RE.test(endDate)) return { ok: false, message: 'Could not work out an end date — give end_date explicitly.' }
  }
  if (daysBetween(startDate, endDate) <= 0) {
    return { ok: false, message: 'end_date has to be after start_date.' }
  }

  const loaded = await loadJob(ctx, jobId)
  if (!loaded.ok) return loaded
  const { job } = loaded

  // The hard guard. Applying a recurrence to a job that already has live visits
  // is the destructive case (see the scope note above) — refuse it outright.
  const open = openVisits(job)
  if (open.length > 0) {
    return {
      ok: false,
      message:
        `Job #${job.jobNumber ?? '?'} already has ${open.length} unfinished visit${open.length === 1 ? '' : 's'} on it. ` +
        'Setting a recurrence now would leave the old visits behind alongside the new series, so I will not do it ' +
        'from here. Rebuilding a live schedule has to be done in Jobber directly. Nothing was changed.',
    }
  }

  // Jobber generates NOTHING when the stored rule already equals the one being
  // sent — the edit is a silent no-op. Catch it here rather than reporting a
  // success that produced no visits.
  if (normalizeRule(job.visitSchedule?.recurrenceSchedule?.calendarRule) === normalizeRule(recurrence)) {
    return {
      ok: false,
      message:
        `Jobber already stores exactly this rule on job #${job.jobNumber ?? '?'} (${job.visitSchedule?.recurrenceSchedule?.friendly || recurrence}) ` +
        'but has no visits from it. Re-sending the same rule generates nothing, so this needs doing in Jobber ' +
        'directly. Nothing was changed.',
    }
  }

  const crew = await matchTeamMembers(loaded.userId, args.assign_to, false)
  if (!crew.ok) return crew

  return {
    ok: true,
    userId: loaded.userId,
    job,
    recurrence,
    startDate,
    endDate,
    members: crew.members,
    dates: expandRecurrence(recurrence, startDate, endDate),
  }
}

export const jobberSetRecurringScheduleAction: HubAction = {
  name: 'jobber_set_recurring_schedule',
  description:
    'Set the repeating schedule on a recurring Jobber job that does not have one yet, and generate its ' +
    'visits. Use this to finish a recurring job created with "schedule later". The recurrence is an iCal ' +
    'rule: "RRULE:FREQ=MONTHLY;BYDAY=2TU" means the 2nd Tuesday of every month; ' +
    '"RRULE:FREQ=DAILY;INTERVAL=46" means every 46 days. ' +
    'NEVER guess the rule or the start date — they decide which day a crew shows up for years, so ask if ' +
    'you are not certain. This will NOT touch a job that already has unfinished visits on it; changing a ' +
    'live schedule has to be done in Jobber. Previews the first few real dates and needs approval.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'Jobber job id (encoded id) from jobber_get_customer_jobs.' },
      recurrence: { type: 'string', description: 'iCal rule starting with "RRULE:".' },
      start_date: { type: 'string', description: 'First date the job runs, YYYY-MM-DD. Anchors the whole series.' },
      end_date: { type: 'string', description: 'Last date, YYYY-MM-DD. Defaults to three years after the start.' },
      assign_to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Crew for the generated visits, by team member name.',
      },
    },
    required: ['job_id', 'recurrence', 'start_date'],
  },
  kind: 'jobber_write',
  gate: JOBBER_WRITE_GATE,
  group: 'jobber',
  defaultOn: false,
  consentLabel: 'set repeating schedules on jobs in Jobber (with your confirmation)',
  run: async (ctx, args) => {
    const resolved = await resolveRecurring(ctx, args)
    if (!resolved.ok) return resolved.message
    const { userId, job, recurrence, startDate, endDate, members, dates } = resolved

    const scheduling: Record<string, unknown> = { createVisits: true, notifyTeam: false, recurrence }
    if (members.length) scheduling.assignedTo = members.map((m) => m.id)

    // Jobber wants a duration, not an end date, and the long-standing convention
    // shared with the MCP server's create_recurring_job is that durationValue is
    // the day count from start — which makes end_date the EXCLUSIVE boundary.
    // Kept identical here so a job set up through the assistant ends on the same
    // day as one set up through the older tooling.
    const timeframe = {
      startAt: startDate,
      durationValue: Math.max(1, daysBetween(startDate, endDate)),
      durationUnits: 'DAYS',
    }

    const resp = await jobberGraphQLAdmin<{
      data?: {
        jobEdit?: {
          job?: {
            jobNumber: number | null
            visitSchedule?: { recurrenceSchedule?: { friendly: string | null } | null } | null
          } | null
          userErrors?: Array<{ message: string }>
        }
      }
    }>(userId, JOB_EDIT_SCHEDULE, { jobId: job.id, input: { scheduling, timeframe } })

    const err = userErrorText(resp.data?.jobEdit?.userErrors)
    if (err) return `Jobber refused that schedule: ${err}. Nothing changed.`
    const edited = resp.data?.jobEdit?.job
    if (!edited) return "The schedule didn't take — nothing changed on the job."

    const friendly = edited.visitSchedule?.recurrenceSchedule?.friendly

    return lines(
      `Schedule set on ${jobLabel(job)}.`,
      `  Repeats: ${friendly || recurrence}`,
      `  From ${startDate} through ${endDate}`,
      members.length ? `  Crew: ${members.map(memberLabel).join(', ')}` : '  Crew: unassigned',
      dates && dates.length ? `  ${countLabel(dates)} visit${dates.length === 1 ? '' : 's'} in the series, starting ${dates.slice(0, 3).join(', ')}` : null,
      '  Jobber generates the visits in the background, so give it a minute before checking the calendar.',
    )
  },
}

export async function previewJobberSetRecurringSchedule(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<{ ok: true; preview: string } | { ok: false; message: string }> {
  const resolved = await resolveRecurring(ctx, args)
  if (!resolved.ok) return { ok: false, message: resolved.message }
  const { job, recurrence, startDate, endDate, members, dates } = resolved

  const today = opsYmd()
  return {
    ok: true,
    preview: lines(
      `  Job: ${jobLabel(job)}`,
      `  Rule: ${recurrence}`,
      `  Runs ${startDate} through ${endDate}`,
      dates && dates.length
        ? `  That is ${countLabel(dates)} visit${dates.length === 1 ? '' : 's'}. First three: ${dates
            .slice(0, 3)
            .map((d) => `${dayLabel(d)} (${d})`)
            .join(' · ')}`
        : dates
          ? '  ⚠ That rule produces NO visits between those dates — check it before approving.'
          : "  ⚠ I couldn't expand that rule into dates, so check it carefully in Jobber afterwards.",
      `  Crew: ${members.length ? members.map(memberLabel).join(', ') : 'unassigned'}`,
      startDate < today ? `  ⚠ The start date is in the past (today is ${today}) — Jobber will not create a visit on it.` : null,
      '  This generates every visit in the series on the real Jobber calendar.',
    ),
  }
}

export const JOBBER_ACTIONS: HubAction[] = [
  jobberFindCustomerAction,
  jobberCustomerJobsAction,
  jobberGetVisitsAction,
  jobberMoneyAction,
  jobberAddNoteAction,
  jobberRescheduleVisitAction,
  jobberAssignVisitAction,
  jobberCompleteVisitAction,
  jobberScheduleVisitAction,
  jobberSetRecurringScheduleAction,
]

/** Preview builders for the confirmed Jobber writes, keyed by action name. */
export const JOBBER_PREVIEW_BUILDERS: Record<
  string,
  (ctx: ActionContext, args: Record<string, unknown>) => Promise<{ ok: true; preview: string } | { ok: false; message: string }>
> = {
  [jobberRescheduleVisitAction.name]: previewJobberReschedule,
  [jobberAssignVisitAction.name]: previewJobberAssign,
  [jobberCompleteVisitAction.name]: previewJobberComplete,
  [jobberScheduleVisitAction.name]: previewJobberScheduleVisit,
  [jobberSetRecurringScheduleAction.name]: previewJobberSetRecurringSchedule,
}
