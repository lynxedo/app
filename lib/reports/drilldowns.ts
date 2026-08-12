import type { SupabaseClient } from '@supabase/supabase-js'
import type { WindowSpec } from '@/lib/scoreboards/widgets/types'
// Generic PostgREST paging helper. It lives in the email module for historical
// reasons rather than domain ones — reused here instead of writing a fourth copy
// of the same 1,000-row loop. That file imports only types, so this costs nothing.
import { fetchAllRows } from '@/lib/email-contacts'

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
  run: (ctx: { supabase: SupabaseClient; companyId: string; win: WindowSpec }) => Promise<DrillRow[]>
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
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
      { key: 'client', label: 'Customer' },
      { key: 'job_number', label: 'Job #', format: 'number' },
      { key: 'title', label: 'Job' },
      { key: 'uninvoiced', label: 'Uninvoiced', format: 'currency' },
      { key: 'created', label: 'Created', format: 'date' },
      { key: 'age_days', label: 'Age', format: 'days' },
    ],
    run: async ({ supabase, companyId }) => {
      const { data, error } = await supabase
        .from('jobs')
        .select('job_number, title, uninvoiced_total, created_at, clients(name)')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .eq('job_status', 'requires_invoicing')
        .order('uninvoiced_total', { ascending: false, nullsFirst: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map(r => {
        const created = (r.created_at as string | null)?.slice(0, 10) ?? null
        return {
          client: (r.clients as { name?: string } | null)?.name ?? 'Unknown customer',
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
      { key: 'client', label: 'Customer' },
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'balance', label: 'Owed', format: 'currency' },
      { key: 'due_date', label: 'Due', format: 'date' },
      { key: 'days_late', label: 'Days late', format: 'days' },
      { key: 'status', label: 'Status' },
    ],
    run: async ({ supabase, companyId }) => {
      const { data, error } = await supabase
        .from('invoices')
        .select('invoice_number, outstanding_balance, due_date, invoice_status, clients(name)')
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
          client: (r.clients as { name?: string } | null)?.name ?? 'Unknown customer',
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
      { key: 'client', label: 'Customer' },
      { key: 'title', label: 'Visit' },
      { key: 'scheduled_date', label: 'Scheduled', format: 'date' },
      { key: 'days_late', label: 'Days late', format: 'days' },
    ],
    run: async ({ supabase, companyId }) => {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('visits')
        .select('title, scheduled_date, clients(name), jobs!inner(job_status, deleted_at)')
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
          client: (r.clients as { name?: string } | null)?.name ?? 'Unknown customer',
          title: (r.title as string | null)?.trim() || '—',
          scheduled_date: r.scheduled_date as string | null,
          days_late: daysAgo(r.scheduled_date as string | null),
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
      { key: 'client', label: 'Customer' },
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
          service: Array.isArray(svc) ? svc.join(', ') : ((svc as string | null) ?? '—'),
          annual_value: num(s.annual_value),
          email: (s.email as string | null) ?? '—',
          last_visit: lastVisitBy.get(client.id) ?? null,
        })
      }
      return rows.sort((a, b) => num(b.annual_value) - num(a.annual_value))
    },
  },
]

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
