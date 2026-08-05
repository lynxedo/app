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
import { lines, resolveDateArg, stampLabel } from './format'

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

async function resolveAssign(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; userId: string; visit: VisitLookup; members: JobberTeamMember[] }
  | { ok: false; message: string }
> {
  const visitId = str(args, 'visit_id')
  const namesRaw = args.assign_to
  if (!visitId) return { ok: false, message: 'Provide a visit_id from jobber_get_visits.' }
  const names = Array.isArray(namesRaw)
    ? namesRaw.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    : typeof namesRaw === 'string' && namesRaw.trim()
      ? [namesRaw]
      : []
  if (names.length === 0) {
    return { ok: false, message: 'Say who to assign — one or more team member names.' }
  }

  const loaded = await loadVisit(ctx, visitId)
  if (!loaded.ok) return loaded

  const teamResp = await jobberGraphQLAdmin<{ data?: { users?: { nodes?: JobberTeamMember[] } } }>(
    loaded.userId,
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

  return { ok: true, userId: loaded.userId, visit: loaded.visit, members: matched }
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

export const JOBBER_ACTIONS: HubAction[] = [
  jobberFindCustomerAction,
  jobberCustomerJobsAction,
  jobberGetVisitsAction,
  jobberMoneyAction,
  jobberAddNoteAction,
  jobberRescheduleVisitAction,
  jobberAssignVisitAction,
  jobberCompleteVisitAction,
]

/** Preview builders for the confirmed Jobber writes, keyed by action name. */
export const JOBBER_PREVIEW_BUILDERS: Record<
  string,
  (ctx: ActionContext, args: Record<string, unknown>) => Promise<{ ok: true; preview: string } | { ok: false; message: string }>
> = {
  [jobberRescheduleVisitAction.name]: previewJobberReschedule,
  [jobberAssignVisitAction.name]: previewJobberAssign,
  [jobberCompleteVisitAction.name]: previewJobberComplete,
}
