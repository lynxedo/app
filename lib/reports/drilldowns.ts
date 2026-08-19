import type { SupabaseClient } from '@supabase/supabase-js'
import type { WindowSpec } from '@/lib/scoreboards/widgets/types'
// Generic PostgREST paging helper. It lives in the email module for historical
// reasons rather than domain ones — reused here instead of writing a fourth copy
// of the same 1,000-row loop. That file imports only types, so this costs nothing.
import { fetchAllRows } from '@/lib/email-contacts'
// The click-through: a customer's name opens their file, where the Call and Text
// buttons are. One helper owns the id mapping — see lib/customer-file.ts for why
// that matters and why it never matches on email.
import { customerFileHref, customerFilePath } from '@/lib/customer-file-href'

/* Drill-downs: the rows behind a number.
 *
 * Every figure on a Report should be openable. A chart you cannot get behind is
 * a claim, and the first thing anyone does with a surprising number is ask which
 * records make it up — the whole reason the $24k unbilled figure went unchallenged
 * for a day was that nobody could list the jobs.
 *
 * ⚠⚠ THE RULE THAT MATTERS: a drill-down MUST reproduce its tile's filter exactly.
 * A list that disagrees with the number above it is worse than no list — it makes
 * a correct figure look broken and a broken one look plausible. Where a tile is
 * computed by an RPC, the notes on each dataset below say which one, so the two
 * can be diffed when either changes.
 *
 * ⚠⚠ SERVICE LINE PROFITABILITY AND CREW & LABOR HAVE NO DRILL-DOWN, DELIBERATELY.
 * Both are assembled by rules a row list cannot reproduce without duplicating the
 * whole RPC: revenue is clamped to the period where timeclock data exists, and it
 * comes from TWO pricing rules at once (recurring work priced per visit from visit
 * line items, one-off work priced on the job and divided across its visits), with
 * labour attributed by which visits a person actually completed. Two attempts at a
 * straightforward row query missed the card by 4.4x and then by 30x — a list that
 * far from the number above it would destroy confidence in a page that is finally
 * correct. Doing these properly means having the RPC return its own rows, which is
 * a bigger change than adding a spec here. Better absent than wrong.
 *
 * ⚠ `commission-deals` is registered under `crew` and is NOT a counter-example to
 * that. It never touches the clamped, dual-priced labour figures; it lists the Lead
 * Tracker deals the SALES-based commission rules ride on, which are reproducible
 * exactly, and its description states outright that rules paid on revenue produced,
 * on a service line, or on particular items are not represented. The `crew`
 * registration is a GATE, not a placement — nothing auto-lists drill-downs on a
 * report page, so it appears only where a commission card links to it.
 *
 * ⚠ ONE EXCEPTION, and it is the exception that proves the rule: `unclassified-work`
 * on Service Lines. It does NOT try to reproduce revenue or labour attribution —
 * it answers only "which visits fell into the Other bucket", which is decided by a
 * three-step precedence (visit line item, then job, then a title prefix). That is
 * reproducible EXACTLY, and it is reproduced by calling a dedicated RPC whose window,
 * visit filter and precedence are copied verbatim from scoreboard_service_lines,
 * rather than by re-deriving any of it here. The list totals $440 against the tile's
 * $440. This is also the list that lets someone FIX the mis-titled jobs feeding it.
 *
 * ⚠ Queries run through the CALLER'S supabase client, never the service-role one.
 * invoices / jobs / visits / recurring_services all carry RLS scoping SELECT to
 * `company_id = get_my_company_id()`, so tenant isolation is enforced by the
 * database rather than by this file remembering to filter.
 */

export type DrillFormat = 'text' | 'currency' | 'number' | 'date' | 'days'

export type DrillColumn = {
  key: string
  label: string
  format?: DrillFormat
  /** Right-align numerics. Defaults from `format`. */
  align?: 'left' | 'right'
  /**
   * Renders this cell as a link to the record it names — the click-through from a
   * report row to the customer file, where texting and calling them live (§8.3).
   *
   * The href sits in another key of the same row, which is deliberately NOT a
   * column: it therefore never renders as a column of its own and never reaches
   * the Excel export, which serialises `columns` only.
   */
  link?: { hrefKey: string; external?: boolean }
}

export type DrillRow = Record<string, string | number | null>

export type DrillSpec = {
  key: string
  title: string
  /** Says what the list IS, including anything it deliberately leaves out. */
  description: string
  /** Report slugs this drill-down can be reached from. */
  reports: string[]
  columns: DrillColumn[]
  /** True when the figure ignores the date picker (point-in-time, like AR). */
  pointInTime?: boolean
  /**
   * ⚠ `supabase` is the CALLER'S client so RLS scopes every table read.
   * `rpcClient` is service-role and is ONLY for `scoreboard_*` RPCs, which are
   * no longer executable by `authenticated` (2026-08-12). The caller's report
   * grant is checked by the route before run() — that check is the only gate.
   */
  run: (ctx: {
    supabase: SupabaseClient
    rpcClient: SupabaseClient
    companyId: string
    win: WindowSpec
    /**
     * Names the calling card was filtered to, from `?people=`. Empty means everyone.
     *
     * ⚠ Only datasets whose card carries a person filter read this. It exists because
     * a drill-down MUST reproduce its tile's filter exactly — a list of everyone under
     * a heading naming one person is the failure this registry's opening note warns
     * about, and it reads as a bug in the number rather than in the list.
     */
    people: string[]
  }) => Promise<DrillRow[]>
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The Customer column, wired to open that customer's file.
 *
 * Declared once because every list that names a customer should behave the same
 * way: a name is a link on all of them or it is confusing on all of them.
 */
const CUSTOMER_COLUMN: DrillColumn = {
  key: 'client', label: 'Customer', link: { hrefKey: 'client_href' },
}

/** Nested-select shape for `clients(id, name)`; PostgREST may hand back an array. */
type JoinedClient = { id?: string; name?: string } | { id?: string; name?: string }[] | null

/** Customer name + the link to their file, from an embedded `clients(id, name)`. */
function clientCell(joined: JoinedClient): { client: string; client_href: string | null } {
  const c = Array.isArray(joined) ? joined[0] : joined
  return {
    client: c?.name?.trim() || 'Unknown customer',
    // No id means no link rather than a link that resolves to nothing.
    client_href: c?.id ? customerFileHref(c.id) : null,
  }
}

/** Whole days between a date string and today; negative = still in the future. */
function daysAgo(date: string | null): number | null {
  if (!date) return null
  const then = Date.parse(`${date}T12:00:00Z`)
  if (Number.isNaN(then)) return null
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`)
  return Math.round((today - then) / 86_400_000)
}

const DRILLDOWNS: DrillSpec[] = [
  {
    key: 'unbilled-work',
    title: 'Work done, not billed',
    description:
      'Jobs Jobber has marked "Requires Invoicing" — finished work with no invoice raised yet. ' +
      'Point-in-time: this is what is unbilled right now, so it ignores the date range above.',
    reports: ['home', 'revenue'],
    pointInTime: true,
    // Mirrors scoreboard_home_pulse -> attention.requires_invoicing_*, which counts
    // jobs by job_status and sums uninvoiced_total. Same filter, no date bound.
    columns: [
      CUSTOMER_COLUMN,
      { key: 'job_number', label: 'Job #', format: 'number' },
      { key: 'title', label: 'Job' },
      { key: 'uninvoiced', label: 'Uninvoiced', format: 'currency' },
      { key: 'created', label: 'Created', format: 'date' },
      { key: 'age_days', label: 'Age', format: 'days' },
    ],
    run: async ({ supabase, companyId }) => {
      const { data, error } = await supabase
        .from('jobs')
        .select('job_number, title, uninvoiced_total, created_at, clients(id, name)')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .eq('job_status', 'requires_invoicing')
        .order('uninvoiced_total', { ascending: false, nullsFirst: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map(r => {
        const created = (r.created_at as string | null)?.slice(0, 10) ?? null
        return {
          ...clientCell(r.clients as JoinedClient),
          job_number: r.job_number as number | null,
          title: (r.title as string | null)?.trim() || '—',
          uninvoiced: num(r.uninvoiced_total),
          created,
          age_days: daysAgo(created),
        }
      })
    },
  },

  {
    key: 'open-invoices',
    title: 'Money owed',
    description:
      'Every invoice still carrying a balance, oldest debt first. Excludes invoices Jobber has ' +
      'marked paid (its own books treat those as settled even where the balance field disagrees) ' +
      'and drafts, which have not been sent. Point-in-time — an invoice raised in March and still ' +
      'unpaid belongs in today\'s figure whatever date range is selected above.',
    reports: ['home', 'revenue'],
    pointInTime: true,
    // Mirrors scoreboard_invoice_ar: outstanding_balance > 0, status not draft, not paid.
    columns: [
      CUSTOMER_COLUMN,
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'balance', label: 'Owed', format: 'currency' },
      { key: 'due_date', label: 'Due', format: 'date' },
      { key: 'days_late', label: 'Days late', format: 'days' },
      { key: 'status', label: 'Status' },
    ],
    run: async ({ supabase, companyId }) => {
      const { data, error } = await supabase
        .from('invoices')
        .select('invoice_number, outstanding_balance, due_date, invoice_status, clients(id, name)')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .gt('outstanding_balance', 0)
        .not('invoice_status', 'in', '(draft,paid)')
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map(r => {
        const due = r.due_date as string | null
        const late = daysAgo(due)
        return {
          ...clientCell(r.clients as JoinedClient),
          invoice_number: (r.invoice_number as string | null) ?? '—',
          balance: num(r.outstanding_balance),
          due_date: due,
          // Not-yet-due reads as blank rather than a negative number of days late.
          days_late: late !== null && late > 0 ? late : null,
          status: (r.invoice_status as string | null) ?? '—',
        }
      })
    },
  },

  {
    key: 'late-visits',
    title: 'Visits past their date, not completed',
    description:
      'Visits scheduled before today that nobody has marked complete. "Late" here is the FACT — ' +
      'scheduled in the past with no completion — not Jobber\'s visit_status label, which ' +
      'disagrees with itself (some visits read LATE while carrying a future date). ' +
      'BILLING-titled visits and archived jobs are excluded.',
    reports: ['home'],
    pointInTime: true,
    // Mirrors scoreboard_home_pulse -> attention.late_visits.
    columns: [
      CUSTOMER_COLUMN,
      { key: 'title', label: 'Visit' },
      { key: 'scheduled_date', label: 'Scheduled', format: 'date' },
      { key: 'days_late', label: 'Days late', format: 'days' },
    ],
    run: async ({ supabase, companyId }) => {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('visits')
        .select('title, scheduled_date, clients(id, name), jobs!inner(job_status, deleted_at)')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .is('completed_at', null)
        .lt('scheduled_date', today)
        .order('scheduled_date', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? [])
        .filter(r => {
          const job = r.jobs as { job_status?: string; deleted_at?: string | null } | null
          if (!job || job.deleted_at || job.job_status === 'archived') return false
          return !((r.title as string | null) ?? '').toUpperCase().includes('BILLING')
        })
        .map(r => ({
          ...clientCell(r.clients as JoinedClient),
          title: (r.title as string | null)?.trim() || '—',
          scheduled_date: r.scheduled_date as string | null,
          days_late: daysAgo(r.scheduled_date as string | null),
        }))
    },
  },

  {
    key: 'jobs-needing-action',
    title: 'Jobs needing action',
    description:
      'Jobs Jobber is holding for someone: "Action Required" means it wants a decision on the ' +
      'job itself, and "Unscheduled" means the work is sold but has no visit on the calendar. ' +
      'Both are shown together because both are jobs that stop moving until a person touches ' +
      'them. Point-in-time — this is the state right now, not a total for the date range.',
    reports: ['home'],
    pointInTime: true,
    // Mirrors scoreboard_home_pulse -> attention.action_required + .unscheduled_jobs,
    // which are two separate counts off the same job_status grouping.
    columns: [
      CUSTOMER_COLUMN,
      { key: 'job_number', label: 'Job #', format: 'number' },
      { key: 'title', label: 'Job' },
      { key: 'status', label: 'Why it is here' },
      { key: 'value', label: 'Uninvoiced', format: 'currency' },
      { key: 'created', label: 'Created', format: 'date' },
    ],
    run: async ({ supabase, companyId }) => {
      const { data, error } = await supabase
        .from('jobs')
        .select('job_number, title, job_status, uninvoiced_total, created_at, clients(id, name)')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .in('job_status', ['action_required', 'unscheduled'])
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      const LABEL: Record<string, string> = {
        action_required: 'Action required',
        unscheduled: 'Sold, never scheduled',
      }
      return (data ?? []).map(r => ({
        ...clientCell(r.clients as JoinedClient),
        job_number: r.job_number as number | null,
        title: (r.title as string | null)?.trim() || '—',
        status: LABEL[r.job_status as string] ?? (r.job_status as string),
        value: num(r.uninvoiced_total),
        created: (r.created_at as string | null)?.slice(0, 10) ?? null,
      }))
    },
  },

  {
    key: 'at-risk-recurring',
    title: 'Recurring customers with nothing booked',
    description:
      'Customers on a live recurring service who have no future visit on the schedule. ' +
      '"Live" means the service is sold AND not cancelled — filtering on the sold status alone ' +
      'counts cancelled customers as at risk and overstates this list roughly sixfold. ' +
      'Recurring services match to customers by email, so any without a matching customer ' +
      'record cannot appear here. Where two customer records share one email address — a ' +
      'duplicate, a renamed account, or two people at the same address — the oldest record ' +
      'is used, consistently, so this list and the count on Home always agree.',
    reports: ['home'],
    pointInTime: true,
    // Mirrors scoreboard_home_pulse -> attention.at_risk_clients. The email join and
    // the cancelled_status = 'Active' filter must stay identical to that RPC.
    columns: [
      CUSTOMER_COLUMN,
      { key: 'service', label: 'Service' },
      { key: 'annual_value', label: 'Annual value', format: 'currency' },
      { key: 'email', label: 'Email' },
      { key: 'last_visit', label: 'Last visit', format: 'date' },
    ],
    run: async ({ supabase, companyId }) => {
      const { data: services, error: sErr } = await supabase
        .from('recurring_services')
        .select('email, service, annual_value, status, cancelled_status')
        .eq('company_id', companyId)
        .eq('cancelled_status', 'Active')
        .ilike('status', 'Sold%')
      if (sErr) throw new Error(sErr.message)

      const emails = new Set((services ?? [])
        .map(s => (s.email as string | null)?.trim().toLowerCase())
        .filter((e): e is string => !!e))
      if (!emails.size) return []

      // ⚠⚠ THE MATCH MUST BE CASE-INSENSITIVE ON BOTH SIDES. The RPC this mirrors
      // joins `lower(cl.email) = lower(ars.email)`; 157 of Heroes' client emails
      // carry uppercase. Lowercasing only the service side and handing the result
      // to `.in('email', …)` is a case-SENSITIVE comparison in Postgres, so those
      // customers silently drop out and the list comes up short against its own
      // tile — the precise failure this file exists to avoid.
      //
      // Paged rather than filtered: there is no case-insensitive `.in()` in
      // PostgREST, and building an .or() of ilike terms from stored email text is
      // both fragile and injection-shaped. The client list is ~1,600 rows.
      const allClients = await fetchAllRows<{ id: string; name: string | null; email: string | null }>(
        () => supabase
          .from('clients')
          .select('id, name, email')
          .eq('company_id', companyId)
          .is('deleted_at', null)
          .order('id', { ascending: true }),
      )

      const clientByEmail = new Map<string, { id: string; name: string }>()
      for (const c of allClients) {
        const key = c.email?.trim().toLowerCase()
        if (!key || !emails.has(key) || clientByEmail.has(key)) continue
        clientByEmail.set(key, { id: c.id, name: c.name ?? 'Unknown customer' })
      }

      const clientIds = [...new Set([...clientByEmail.values()].map(c => c.id))]
      const today = new Date().toISOString().slice(0, 10)
      const hasUpcoming = new Set<string>()
      const lastVisitBy = new Map<string, string>()
      for (let i = 0; i < clientIds.length; i += 100) {
        const slice = clientIds.slice(i, i + 100)
        const { data: vs, error: vErr } = await supabase
          .from('visits')
          .select('client_id, scheduled_date, completed_at')
          .eq('company_id', companyId)
          .is('deleted_at', null)
          .in('client_id', slice)
        if (vErr) throw new Error(vErr.message)
        for (const v of vs ?? []) {
          const cid = v.client_id as string
          const d = v.scheduled_date as string | null
          if (d && d >= today && !v.completed_at) hasUpcoming.add(cid)
          if (d && (!lastVisitBy.has(cid) || d > (lastVisitBy.get(cid) as string))) lastVisitBy.set(cid, d)
        }
      }

      const seen = new Set<string>()
      const rows: DrillRow[] = []
      for (const s of services ?? []) {
        const key = (s.email as string | null)?.trim().toLowerCase()
        const client = key ? clientByEmail.get(key) : undefined
        if (!client || hasUpcoming.has(client.id) || seen.has(client.id)) continue
        seen.add(client.id)
        const svc = s.service
        rows.push({
          client: client.name,
          // The whole point of this list is to chase these customers, so the name
          // opens the file the Call and Text buttons live on. The id came from the
          // Jobber mirror above, not from the email match, so the link is exact
          // even though the row itself was found by email.
          client_href: customerFileHref(client.id),
          service: Array.isArray(svc) ? svc.join(', ') : ((svc as string | null) ?? '—'),
          annual_value: num(s.annual_value),
          email: (s.email as string | null) ?? '—',
          last_visit: lastVisitBy.get(client.id) ?? null,
        })
      }
      return rows.sort((a, b) => num(b.annual_value) - num(a.annual_value))
    },
  },
  {
    key: 'invoices-issued',
    title: 'Invoices issued',
    description:
      'Every invoice raised in the selected period, with what has been collected against it. ' +
      'Drafts are excluded — they have not been sent, so they are not billed revenue. ' +
      '"Collected" is derived from the balance rather than the payments column, which is not ' +
      'populated on a meaningful number of older invoices.',
    reports: ['revenue'],
    // Mirrors scoreboard_invoice_window: issued_date within range, drafts excluded.
    columns: [
      CUSTOMER_COLUMN,
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'issued_date', label: 'Issued', format: 'date' },
      { key: 'total', label: 'Invoiced', format: 'currency' },
      { key: 'collected', label: 'Collected', format: 'currency' },
      { key: 'balance', label: 'Still owed', format: 'currency' },
      { key: 'status', label: 'Status' },
    ],
    run: async ({ supabase, companyId, win }) => {
      const rows = await fetchAllRows<Record<string, unknown>>(() => supabase
        .from('invoices')
        .select('invoice_number, issued_date, total, outstanding_balance, invoice_status, clients(id, name)')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .neq('invoice_status', 'draft')
        .gte('issued_date', win.start)
        .lte('issued_date', win.end)
        .order('issued_date', { ascending: false }))
      return rows.map(r => {
        const total = num(r.total)
        const bal = num(r.outstanding_balance)
        return {
          ...clientCell(r.clients as JoinedClient),
          invoice_number: (r.invoice_number as string | null) ?? '—',
          issued_date: (r.issued_date as string | null),
          total,
          // Never negative: a credit balance would otherwise read as over-collection.
          collected: Math.max(0, total - bal),
          balance: bal,
          status: (r.invoice_status as string | null) ?? '—',
        }
      })
    },
  },

  {
    key: 'draft-invoices',
    title: 'Draft invoices',
    description:
      'Invoices started but never sent. Counted company-wide rather than by date, because a ' +
      'draft often has no issue date at all — filtering by the date range would hide exactly ' +
      'the ones that have been sitting longest.',
    reports: ['revenue'],
    pointInTime: true,
    columns: [
      CUSTOMER_COLUMN,
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'total', label: 'Value', format: 'currency' },
      { key: 'issued_date', label: 'Issue date', format: 'date' },
    ],
    run: async ({ supabase, companyId }) => {
      const { data, error } = await supabase
        .from('invoices')
        .select('invoice_number, total, issued_date, clients(id, name)')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .eq('invoice_status', 'draft')
        .order('total', { ascending: false, nullsFirst: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map(r => ({
        ...clientCell(r.clients as JoinedClient),
        invoice_number: (r.invoice_number as string | null) ?? '—',
        total: num(r.total),
        issued_date: (r.issued_date as string | null),
      }))
    },
  },

  {
    key: 'customers-billed',
    title: 'What each customer was billed',
    description:
      'Every customer invoiced in the selected period, biggest first. This is what they were ' +
      'BILLED in that window — not a lifetime total. Customer records go back further than the ' +
      'invoice records do, so anyone who joined earlier has paid more than this shows.',
    reports: ['clients'],
    columns: [
      CUSTOMER_COLUMN,
      { key: 'invoices', label: 'Invoices', format: 'number' },
      { key: 'billed', label: 'Billed', format: 'currency' },
      { key: 'collected', label: 'Collected', format: 'currency' },
      { key: 'owed', label: 'Still owed', format: 'currency' },
      { key: 'last_invoice', label: 'Last invoiced', format: 'date' },
    ],
    run: async ({ supabase, companyId, win }) => {
      const rows = await fetchAllRows<Record<string, unknown>>(() => supabase
        .from('invoices')
        .select('total, outstanding_balance, issued_date, client_id, clients(id, name)')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .neq('invoice_status', 'draft')
        .gte('issued_date', win.start)
        .lte('issued_date', win.end)
        .order('id', { ascending: true }))

      // Grouped here rather than in SQL: PostgREST cannot GROUP BY, and a dedicated
      // RPC for a list this size would be a migration for no gain.
      const byClient = new Map<string, DrillRow>()
      for (const r of rows) {
        const id = (r.client_id as string | null) ?? 'unknown'
        const cur = byClient.get(id) ?? {
          ...clientCell(r.clients as JoinedClient),
          invoices: 0, billed: 0, collected: 0, owed: 0, last_invoice: null,
        }
        const total = num(r.total)
        const bal = num(r.outstanding_balance)
        cur.invoices = num(cur.invoices) + 1
        cur.billed = num(cur.billed) + total
        cur.collected = num(cur.collected) + Math.max(0, total - bal)
        cur.owed = num(cur.owed) + bal
        const d = r.issued_date as string | null
        if (d && (!cur.last_invoice || d > String(cur.last_invoice))) cur.last_invoice = d
        byClient.set(id, cur)
      }
      return [...byClient.values()].sort((a, b) => num(b.billed) - num(a.billed))
    },
  },

  {
    key: 'recurring-customers',
    title: 'Recurring customers',
    description:
      'The live recurring book — customers on a sold recurring service that has not been ' +
      'cancelled. Point-in-time: this is who is on the book today, not who was on it during ' +
      'the selected range.',
    reports: ['clients', 'retention'],
    pointInTime: true,
    columns: [
      { key: 'name', label: 'Customer' },
      { key: 'service', label: 'Service' },
      { key: 'annual_value', label: 'Annual value', format: 'currency' },
      { key: 'salesperson', label: 'Sold by' },
      { key: 'sold_date', label: 'Sold', format: 'date' },
      { key: 'source', label: 'Lead source' },
    ],
    run: async ({ supabase, companyId }) => {
      const rows = await fetchAllRows<Record<string, unknown>>(() => supabase
        .from('recurring_services')
        .select('name, service, annual_value, salesperson, sold_date, lead_source')
        .eq('company_id', companyId)
        .eq('cancelled_status', 'Active')
        .ilike('status', 'Sold%')
        .order('id', { ascending: true }))
      return rows.map(r => ({
        name: (r.name as string | null) ?? '—',
        service: Array.isArray(r.service) ? (r.service as string[]).join(', ') : ((r.service as string | null) ?? '—'),
        annual_value: num(r.annual_value),
        salesperson: (r.salesperson as string | null) ?? '—',
        sold_date: (r.sold_date as string | null),
        source: (r.lead_source as string | null) ?? 'Other / Unknown',
      })).sort((a, b) => num(b.annual_value) - num(a.annual_value))
    },
  },

  {
    key: 'cancellations',
    title: 'Cancelled recurring customers',
    description:
      'Recurring customers who cancelled in the selected period, with the reason recorded. ' +
      'Rows with no cancellation date cannot be placed in a period and are left out — the ' +
      'count of those is worth knowing separately if this list looks short.',
    reports: ['retention'],
    columns: [
      { key: 'name', label: 'Customer' },
      { key: 'service', label: 'Service' },
      { key: 'annual_value', label: 'Annual value lost', format: 'currency' },
      { key: 'reason', label: 'Reason' },
      { key: 'cancel_date', label: 'Cancelled', format: 'date' },
      { key: 'source', label: 'Lead source' },
    ],
    run: async ({ supabase, companyId, win }) => {
      const rows = await fetchAllRows<Record<string, unknown>>(() => supabase
        .from('recurring_services')
        .select('name, service, annual_value, cancellation_reason, cancel_date, lead_source, cancelled_status')
        .eq('company_id', companyId)
        .neq('cancelled_status', 'Active')
        .gte('cancel_date', win.start)
        .lte('cancel_date', win.end)
        .order('cancel_date', { ascending: false }))
      return rows.map(r => ({
        name: (r.name as string | null) ?? '—',
        service: Array.isArray(r.service) ? (r.service as string[]).join(', ') : ((r.service as string | null) ?? '—'),
        annual_value: num(r.annual_value),
        reason: (r.cancellation_reason as string | null) ?? 'Not recorded',
        cancel_date: (r.cancel_date as string | null),
        source: (r.lead_source as string | null) ?? 'Other / Unknown',
      }))
    },
  },

  {
    key: 'leads',
    title: 'Leads',
    description:
      'Every lead created in the selected period — the same cohort the close rate is worked ' +
      'out from, so the two always agree. Leads marked bad, unreachable or duplicate are ' +
      'included here and labelled, because they are real rows worth seeing even though they ' +
      'are excluded from the close rate.',
    reports: ['sales'],
    columns: [
      { key: 'name', label: 'Lead' },
      { key: 'service', label: 'Service' },
      { key: 'source', label: 'Source' },
      { key: 'salesperson', label: 'Salesperson' },
      { key: 'status', label: 'Status' },
      { key: 'annual_value', label: 'Annual value', format: 'currency' },
      { key: 'created', label: 'Created', format: 'date' },
      { key: 'sold_date', label: 'Sold', format: 'date' },
    ],
    run: async ({ supabase, companyId, win }) => {
      const rows = await fetchAllRows<Record<string, unknown>>(() => supabase
        .from('leads')
        .select('first_name, last_name, service, lead_source, salesperson, status, annual_value, lead_creation_date, sold_date')
        .eq('company_id', companyId)
        .gte('lead_creation_date', win.start)
        .lte('lead_creation_date', win.end)
        .order('lead_creation_date', { ascending: false }))
      return rows.map(r => ({
        name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || '—',
        service: (r.service as string | null) ?? '—',
        source: (r.lead_source as string | null) ?? 'Other / Unknown',
        // Unassigned is called out rather than blank: leads with no salesperson
        // close far worse, and that is the point of looking at this list.
        salesperson: (r.salesperson as string | null)?.trim() || '⚠ Unassigned',
        status: (r.status as string | null) ?? '—',
        annual_value: num(r.annual_value),
        created: (r.lead_creation_date as string | null),
        sold_date: (r.sold_date as string | null),
      }))
    },
  },

  {
    key: 'missed-calls',
    title: 'Missed calls',
    description:
      'Inbound calls in the selected period that nobody answered — worked out from whether the ' +
      'call was actually picked up, not from the status the phone system recorded, because a ' +
      'call can read "completed" while meaning only that it ended. Calls the AI receptionist ' +
      'answered count as answered and are not here.',
    reports: ['communications'],
    columns: [
      // The NUMBER carries the link, not the Contact column: a missed call from
      // someone not in the directory shows a blank contact, and a dash is a poor
      // thing to ask anyone to click. Calling them back is the action, so the
      // number is what a person reaches for.
      { key: 'from_number', label: 'From', link: { hrefKey: 'contact_href' } },
      { key: 'contact', label: 'Contact' },
      { key: 'when', label: 'When', format: 'date' },
      { key: 'status', label: 'Outcome' },
    ],
    run: async ({ supabase, companyId, win }) => {
      const rows = await fetchAllRows<Record<string, unknown>>(() => supabase
        .from('calls')
        .select('from_number, created_at, status, contact_id')
        .eq('company_id', companyId)
        .eq('direction', 'inbound')
        .is('answered_at', null)
        .gte('created_at', `${win.start}T00:00:00`)
        .lte('created_at', `${win.end}T23:59:59`)
        .order('created_at', { ascending: false }))

      const ids = [...new Set(rows.map(r => r.contact_id as string | null).filter((v): v is string => !!v))]
      const nameById = new Map<string, string>()
      // Which contacts still exist — a call keeps its contact_id after the record is
      // deleted, so link only where the file can actually open.
      const live = new Set<string>()
      for (let i = 0; i < ids.length; i += 100) {
        const { data: cs } = await supabase
          .from('txt_contacts')
          .select('id, name')
          .is('deleted_at', null)
          .in('id', ids.slice(i, i + 100))
        for (const c of cs ?? []) {
          live.add(c.id as string)
          const n = (c.name as string | null)?.trim()
          if (n) nameById.set(c.id as string, n)
        }
      }

      return rows.map(r => {
        const cid = (r.contact_id as string | null) ?? ''
        return {
          from_number: (r.from_number as string | null) ?? '—',
          // Blank rather than "Unknown": an unnamed caller is a known gap in the
          // directory, not a fact about the call.
          contact: nameById.get(cid) ?? '—',
          // Already a directory id, so it needs no resolving — /customer/<id> exists
          // only because report rows carry Jobber's id for the customer, not ours.
          contact_href: live.has(cid) ? customerFilePath(cid) : null,
          when: (r.created_at as string | null)?.slice(0, 10) ?? null,
          status: (r.status as string | null) ?? '—',
        }
      })
    },
  },
  {
    key: 'unclassified-work',
    title: 'Work with no service line',
    description:
      'Completed visits that Service Line Profitability could not file under a service line, ' +
      'so their revenue and labour sit in "Other / Unclassified". A visit lands here when no ' +
      'line item on it carries a department prefix, the job has none either, and the job title ' +
      'does not start with one. Usually a title typo or a line item named differently from the ' +
      'catalogue — each row shows the job title and the line items so it can be corrected at ' +
      'source. Clamped to the period where timeclock data exists, exactly like the report.',
    reports: ['service-lines'],
    columns: [
      { key: 'client', label: 'Customer' },
      { key: 'job_title', label: 'Job title' },
      { key: 'items', label: 'Line items on the visit' },
      { key: 'completed', label: 'Completed', format: 'date' },
      { key: 'revenue', label: 'Revenue', format: 'currency' },
    ],
    // Mirrors scoreboard_service_lines' "Other" bucket. The RPC exists precisely so
    // the precedence is not re-implemented here and cannot drift from the tile.
    run: async ({ rpcClient, companyId, win }) => {
      const { data, error } = await rpcClient.rpc('scoreboard_service_lines_unclassified', {
        p_company_id: companyId, p_start: win.start, p_end: win.end,
      })
      if (error) throw new Error(`unclassified-work: ${error.message}`)
      return (data ?? []) as DrillRow[]
    },
  },
  {
    key: 'commission-deals',
    title: 'Deals behind the commission figures',
    /* ⚠⚠ THE DESCRIPTION IS LOAD-BEARING, because this list can only reproduce SOME
     * of the bases. The three sales bases ride on Lead Tracker deals and those are
     * listable exactly. "Revenue they produced", "revenue of a whole service line"
     * and "particular things they sold" do NOT have a deal list behind them — the
     * first two are the clamped, dual-priced Crew & Labor figures this registry
     * refuses to approximate, and the third is a per-item tally. Saying so is the
     * difference between a list that is narrower than the card and a list that looks
     * like it disagrees with it. */
    description:
      'Every Lead Tracker deal credited to the people who hold a commission rule, in this date range — the deals the sales-based rules are paid on. Each row says whether it was new business (Closed Won) or an upsell, so the two halves can be added up separately. Rules paid on revenue produced, on a whole service line, or on particular things sold are NOT represented here: those figures have no deal list behind them.',
    reports: ['crew'],
    /* ⚠ The customer is a plain NAME, not a link to their file, and that is the
     * established rule rather than an omission: `leads` carries no client id at all
     * (only a name, phone and email), and matching a lead to a customer file on email
     * or phone is exactly the mapping §8.3 refused — three Heroes customers share an
     * email, so a "helpful" match opens the WRONG person's record. Absent beats wrong. */
    columns: [
      { key: 'client', label: 'Customer' },
      { key: 'salesperson', label: 'Credited to' },
      { key: 'kind', label: 'Counts as' },
      { key: 'program', label: 'Program sold' },
      { key: 'created', label: 'Lead came in', format: 'date' },
      { key: 'sold', label: 'Sold', format: 'date' },
      { key: 'value', label: 'Annual value', format: 'currency' },
    ],
    run: async ({ supabase, rpcClient, companyId, win, people }) => {
      /* ⚠ Which stages count as an upsell is READ, never assumed — it is the tenant's
       * own `counts_as_sale` ticks, the same flag `scoreboard_sales` reads. Hardcoding
       * 'upsells' would be a second definition that drifts from the cards. */
      const { data: stageRows } = await supabase
        .from('tracker_stages')
        .select('key, counts_as_sale')
        .eq('company_id', companyId)
      const saleStages = new Set(
        ((stageRows ?? []) as { key: string; counts_as_sale: boolean }[])
          .filter(r => r.counts_as_sale).map(r => r.key),
      )

      /* Who holds a rule. ⚠ Read through the SERVICE-ROLE client: `commission_plans`
       * is RLS-on with no policies, so the caller's client returns zero rows silently.
       * Safe because the route has already checked the Crew & Labor grant, which is
       * the same gate the commission cards answer to. */
      const { data: planRows } = await rpcClient
        .from('commission_plans')
        .select('employee_id, active')
        .eq('company_id', companyId)
      const holders = new Set(
        ((planRows ?? []) as { employee_id: string; active: boolean }[])
          .filter(r => r.active).map(r => r.employee_id),
      )
      if (!holders.size) return []

      // Their names as the commission cards spell them — same source, so the match
      // against `leads.salesperson` is made the same way `scoreboard_people` makes it.
      const { data: peopleData } = await rpcClient.rpc('scoreboard_people', {
        p_company_id: companyId, p_start: win.start, p_end: win.end,
      })
      const nameByEmp = new Map<string, string>()
      for (const p of ((peopleData as { people?: { employee_id: string; name: string }[] } | null)?.people ?? [])) {
        nameByEmp.set(p.employee_id, p.name)
      }
      // ⚠ The card's own filter, reproduced. Without this the list would show every
      // plan-holder under a heading naming one person.
      const wanted = new Set(
        [...holders]
          .map(id => nameByEmp.get(id))
          .filter((n): n is string => !!n)
          .filter(n => !people.length || people.some(w => w.trim().toLowerCase() === n.toLowerCase()))
          .map(n => n.toLowerCase()),
      )
      if (!wanted.size) return []

      /* ⚠⚠ Filtered on SOLD_DATE, matching the commission bases. This used to filter
       * `lead_creation_date` with a comment explaining that the bases did the same —
       * and when the bases moved to close date the comment became the bug it was
       * written to prevent, since a downloaded list quietly holding different rows
       * than the total above it is the kind of thing nobody notices until it is in a
       * spreadsheet. A won lead always has a sold date (checked: 0 of 474 in 2026 do
       * not), so nothing falls out of the list by moving. */
      const rows = await fetchAllRows<{
        stage: string | null; salesperson: string | null; annual_value: number | null
        lead_creation_date: string | null; sold_date: string | null
        first_name: string | null; last_name: string | null; base_program_sold: string | null
      }>(() => supabase
        .from('leads')
        .select('stage, salesperson, annual_value, lead_creation_date, sold_date, first_name, last_name, base_program_sold')
        .eq('company_id', companyId)
        .gte('sold_date', win.start)
        .lte('sold_date', win.end)
        // Stable order so paging cannot drop or repeat a row at a page edge.
        .order('sold_date', { ascending: false }))

      return rows
        .filter(r => {
          const stage = r.stage ?? ''
          if (stage !== 'closed_won' && !saleStages.has(stage)) return false
          // `scoreboard_people` matches a rep on the FIRST name, lowercased. Matched
          // the same way here so the list cannot credit a deal the card did not.
          const first = (r.salesperson ?? '').trim().split(' ')[0]?.toLowerCase() ?? ''
          if (!first) return false
          return [...wanted].some(w => w.split(' ')[0] === first)
        })
        .map(r => ({
          client: [r.first_name, r.last_name].map(v => (v ?? '').trim()).filter(Boolean).join(' ') || 'Unnamed lead',
          salesperson: (r.salesperson ?? '').trim() || 'Unassigned',
          kind: r.stage === 'closed_won' ? 'New business' : 'Upsell',
          program: (r.base_program_sold ?? '').trim() || '—',
          created: r.lead_creation_date,
          sold: r.sold_date,
          value: num(r.annual_value),
        }))
        .sort((a, b) => Number(b.value) - Number(a.value))
    },
  },
]
/**
 * The `?people=` filter a drill-down link carries, parsed once.
 *
 * ⚠ Shared by the page and the Excel export deliberately: they must narrow to the
 * same set, or the downloaded file would quietly contain rows the page never showed.
 * Bounded — a filter is only ever used to REMOVE rows the caller could already read,
 * so the cap costs nothing but keeps a hand-typed URL from being unbounded work.
 */
export function parseDrillPeople(raw: string | string[] | undefined): string[] {
  const one = Array.isArray(raw) ? raw[0] : raw
  if (!one) return []
  return one.split(',').map(s => s.trim()).filter(Boolean).slice(0, 40)
}

export function getDrilldown(key: string): DrillSpec | undefined {
  return DRILLDOWNS.find(d => d.key === key)
}

/** Drill-downs reachable from a given report, for links and for the index page. */
export function drilldownsForReport(slug: string): DrillSpec[] {
  return DRILLDOWNS.filter(d => d.reports.includes(slug))
}

export function drilldownExists(reportSlug: string, key: string): boolean {
  const d = getDrilldown(key)
  return !!d && d.reports.includes(reportSlug)
}
