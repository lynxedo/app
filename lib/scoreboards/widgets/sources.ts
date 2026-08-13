/* Source layer — the only place a widget's data comes from the database.
 *
 * A source is ONE parameterized query. Widgets declare which sources they need
 * (never how to fetch them), so the resolver can run each unique query once no
 * matter how many widgets asked for it. Board 8 alone has EIGHT widgets reading
 * the scorecard; without this they'd be eight round-trips.
 *
 * Every executor scopes by company_id itself. Some run through gated
 * SECURITY DEFINER RPCs whose grants were tightened in July 2026 — do not widen
 * them here (see supabase/2026-07-05_security_revoke_anon_access.sql).
 *
 * ⚠⚠ TWO CLIENTS, AND THE DIFFERENCE IS THE SECURITY BOUNDARY.
 *
 * `ctx.supabase` is the signed-in user's client: RLS applies, so a plain table
 * read can only ever return their own company's rows. Use it for table queries.
 *
 * `ctx.rpcClient` is service-role and used ONLY to call `scoreboard_*` RPCs.
 * Those functions used to be callable by any signed-in user, and the only
 * check inside them was "can you see Reports or Scoreboards *at all*" — so a
 * technician granted two boards could POST to /rest/v1/rpc and read every
 * report's data, including per-person hours and labour cost (proven live on
 * 2026-08-12 by impersonating a technician in SQL). Per-report and per-board
 * grants were enforced in the app only.
 *
 * The fix was to revoke EXECUTE from `authenticated` on every scoreboard_*
 * function, leaving the API routes as the single door — they already check the
 * grants correctly. That is why these calls need service-role: users can no
 * longer make them directly, by design.
 *
 * ⚠ THE RULE THIS CREATES: a route that resolves widgets MUST check the
 * caller's report/board grant before calling. There is no second net below it.
 * `companyId` must come from the session's profile, never from the request.
 */

import type { createClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { SourceKey, SourceParams } from './types'

type ServerClient = Awaited<ReturnType<typeof createClient>>
type ServiceClient = ReturnType<typeof createAdminClient>

export type SourceContext = {
  /** The signed-in user's client — RLS applies. Table reads only. */
  supabase: ServerClient
  /** Service-role, for `scoreboard_*` RPCs only. See the warning above. */
  rpcClient: ServiceClient
  companyId: string
}

export type SourceExecutor = (ctx: SourceContext, params: SourceParams) => Promise<unknown[]>

/* ── Row shapes (mirror what the RPCs return) ───────────────────────────── */

export type ScorecardRow = {
  source: string
  source_group: string
  cost_type: string
  total_customers: number
  active_count: number
  churned_count: number
  retention_pct: number | null
  /** ⚠ Named for the year-based original; means "new within the window". Both
   *  RPCs return the same shape deliberately, so they share this one type. */
  new_in_year: number
  active_annual_value: number
  avg_annual_value: number | null
  avg_tenure_months: number | null
  est_ltv: number | null
  unresolved_count: number
}

export type DecidedLeadRow = {
  lead_source: string | null
  stage: string | null
}

/** One row per year — the whole retention picture for that year's book. */
export type ChurnSummaryRow = {
  year: number
  book_size: number
  active_now: number
  new_in_year: number
  churned_gross: number
  churned_controllable: number
  churned_company_initiated: number
  churned_uncontrollable: number
  churned_review: number
  churned_annual_value: number
  active_annual_value: number
  retention_pct: number | null
  gross_churn_pct: number | null
  controllable_churn_pct: number | null
  by_reason: { reason: string; churn_type: string; count: number; annual_value: number }[]
  by_type: { churn_type: string; count: number; annual_value: number }[]
  monthly: { month: string; gross: number; controllable: number }[]
}

/** Billed-and-collected for one window. One composite row, like churn_summary. */
export type InvoiceWindowRow = {
  invoiced: number
  collected: number
  still_owed: number
  invoice_count: number
  avg_invoice: number | null
  subtotal: number
  tax: number
  tips: number
  discounts: number
  median_days_to_pay: number | null
  avg_days_to_pay: number | null
  paid_count: number
  draft_count: number
  draft_value: number
  /** Oldest invoice the mirror holds — lets a widget say "we don't have data that far back". */
  earliest_invoice: string | null
  monthly: { month: string; invoiced: number; collected: number; count: number }[]
  mix: { kind: string; count: number; invoiced: number }[]
}

/** What is owed right now. No window — receivables are point-in-time. */
export type InvoiceArRow = {
  as_of: string
  total_ar: number
  open_count: number
  overdue_total: number
  overdue_count: number
  /** Invoices Jobber marks paid that still carry a balance. Real money, easily hidden. */
  paid_status_still_owing_count: number
  paid_status_still_owing_value: number
  draft_count: number
  draft_value: number
  credit_count: number
  credit_balance: number
  buckets: { bucket: string; sort: number; count: number; balance: number }[]
  invoices: {
    id: string
    invoice_number: string | null
    client_id: string | null
    client_name: string
    balance: number
    days_past_due: number
    issued_date: string | null
    status: string
  }[]
}

/** One person's clocked time and the work credited to them. */
export type CrewPerson = {
  employee_id: string
  name: string
  department: string
  is_active: boolean
  pay_type: string
  hours: number
  labor_cost: number | null
  /** False when nobody in Jobber matches them, so no work can be credited. */
  attributable: boolean
  /** False for salaried staff and anyone under an hour — no $/hour is shown. */
  rankable: boolean
  revenue: number | null
  rev_per_hour: number | null
}

export type CrewLaborRow = {
  /** What the source actually measured, which may be narrower than the request. */
  coverage: {
    timeclock_first: string | null
    timeclock_last: string | null
    effective_start: string | null
    effective_end: string | null
    requested_start: string
    requested_end: string
    clamped: boolean
    has_data: boolean
    /** True when months before the timeclock are covered by the payroll backfill. */
    backfilled?: boolean
    /** Last day the payroll backfill covers; the timeclock takes over the next day. */
    backfill_until?: string | null
  }
  hours: number
  labor_cost: number
  revenue: number
  visits: number
  rev_per_hour: number | null
  rev_per_visit: number | null
  labor_pct: number | null
  unattributed_count: number
  unattributed_hours: number
  unattributed_names: string[]
  salaried_note: number
  people: CrewPerson[]
  by_department: { department: string; hours: number; labor_cost: number; people: number }[]
}

/** Dialer + Txt responsiveness for a window. */
export type CommsRow = {
  coverage: {
    /** Earliest call/text we hold, so a widget can flag a window reaching further back. */
    first_call: string | null
    first_text: string | null
    requested_start: string
    requested_end: string
  }
  inbound_calls: number
  outbound_calls: number
  answered_human: number
  /** Amber. Counts as answered — she is the receptionist, not a failure mode. */
  answered_ai: number
  missed: number
  missed_pct: number | null
  missed_with_voicemail: number
  missed_no_message: number
  /** Under 5 seconds — nobody could have reached the phone. */
  missed_quick_hangup: number
  median_answer_sec: number | null
  avg_answer_sec: number | null
  answer_sample: number
  texts_in: number
  texts_out: number
  texts_failed: number
  median_reply_sec: number | null
  p90_reply_sec: number | null
  reply_sample: number
  voicemails: number
  voicemails_unheard: number
  by_hour: { hour: number; inbound: number; missed: number }[]
  by_weekday: { dow: number; label: string; inbound: number; missed: number }[]
}

/** Client base size, growth, geography and spend. */
export type ClientsRow = {
  coverage: {
    first_client: string | null
    /** ⚠ The billing floor. Per-client spend starts here, so it is NOT lifetime value. */
    first_invoice: string | null
    requested_start: string
    requested_end: string
  }
  /** Excludes rows Jobber still flags as leads — they have never bought anything. */
  clients_total: number
  clients_active: number
  clients_archived: number
  leads_open: number
  new_in_window: number
  new_30d: number
  billed_clients: number
  billed_total: number
  billed_avg: number | null
  recurring_services: number
  recurring_annual_value: number
  new_by_month: { month: string; count: number }[]
  by_city: { city: string; clients: number }[]
  top_clients: {
    client_id: string
    name: string
    billed: number
    invoices: number
    first_billed: string | null
    last_billed: string | null
    days_since_last: number
    archived: boolean
  }[]
}

/** Where the customers and the money are, by ZIP. */
export type ClientsGeoRow = {
  /** ZIPs we hold customers in but cannot place on a map. Stated, never dropped. */
  unmapped_zips: number
  unmapped_clients: number
  points: {
    zip: string
    lat: number
    lng: number
    revenue: number
    recurring_clients: number
    oneoff_clients: number
    total_clients: number
  }[]
}

/** One service line's revenue, allocated labor and what survives wages. */
export type ServiceLine = {
  dept: string
  revenue: number
  revenue_recurring: number
  revenue_oneoff: number
  visits: number
  hours: number
  labor_cost: number
  after_labor: number
  after_labor_pct: number | null
  rev_per_hour: number | null
}

export type ServiceLinesRow = {
  coverage: {
    timeclock_first: string | null
    timeclock_last: string | null
    effective_start: string | null
    effective_end: string | null
    requested_start: string
    requested_end: string
    clamped: boolean
    has_data: boolean
  }
  revenue_total: number
  /** Total payroll = allocated + unassigned. The two always reconcile. */
  labor_total: number
  labor_allocated: number
  hours_total: number
  /** Paid hours on days with no completed visit — 28% of Heroes' wage bill. */
  unassigned_hours: number
  unassigned_cost: number
  material_mapping_line_items: number
  lines: ServiceLine[]
}

/** Lead-Tracker funnel for a cohort of leads created in the window. */
export type SalesRow = {
  leads: number
  won: number
  lost: number
  decided: number
  open: number
  /** Bad Lead / Unreachable / Duplicate — excluded from close rate, reported anyway. */
  excluded_junk: number
  close_rate: number | null
  won_value: number
  avg_deal: number | null
  median_days_to_close: number | null
  avg_days_to_close: number | null
  close_time_sample: number
  attempts_leads: number
  attempts_total: number
  /** Minimum decided leads before a rate is shown at all. */
  rate_min_sample: number
  by_month: { month: string; leads: number; won: number; decided: number; close_rate: number | null }[]
  by_source: { source: string; leads: number; won: number; decided: number; close_rate: number | null; value: number }[]
  by_salesperson: { name: string; leads: number; won: number; decided: number; close_rate: number | null; value: number }[]
  lost_reasons: { reason: string; count: number }[]
  open_by_stage: { stage: string; count: number }[]
}

/** What needs doing right now, plus the work already on the calendar. No window. */
export type HomePulseRow = {
  as_of: string
  attention: {
    requires_invoicing_count: number
    requires_invoicing_value: number
    action_required: number
    unscheduled_jobs: number
    late_visits: number
    oldest_late_visit: string | null
    at_risk_clients: number
    /** Recurring services that could not be matched to a client can never appear
     *  in the at-risk list — the count states its own blind spot. */
    at_risk_services_total: number
    at_risk_services_matched: number
  }
  booked: {
    months: { month: string; recurring: number; oneoff: number; total: number; visits: number; unpriced: number }[]
    total: number
    visits: number
    /** Scheduled recurring visits carrying no line item — real work this can't price. */
    unpriced_visits: number
    horizon_months: number
    first_month_partial: boolean
  }
}

/* ── Executors ──────────────────────────────────────────────────────────── */

const SOURCES: Record<SourceKey, SourceExecutor> = {
  /**
   * Lead-source scorecard: per-source volume, value and loyalty over the
   * recurring book, for an arbitrary window.
   *
   * Uses `scoreboard_source_scorecard_range`, added Aug 10 2026 so the board's
   * date-range control means something here. The original `scoreboard_source_
   * scorecard(company, year)` still exists and still backs the hardcoded Board 8
   * and the weekly snapshot cron — verified byte-identical output for a
   * Jan 1 → today window, so migrating between them changed no number.
   *
   * ⚠ This is the RPC that hit an 8.5s statement timeout in July before its
   * functional indexes landed. Wide windows are the risk case; if a very wide
   * range ever gets slow, that's where to look first.
   */
  source_scorecard: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_source_scorecard_range', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`source_scorecard: ${error.message}`)
    return (data ?? []) as ScorecardRow[]
  },

  /**
   * Lead Tracker leads CREATED in the window that have since been decided.
   * Cohort basis (created-in-window, not decided-in-window) matches how the
   * Office board already reports close rate, so the two agree.
   */
  /**
   * Retention and churn for ONE calendar year's book.
   *
   * ⚠ Deliberately year-based, not widened to a date range like the scorecard was.
   * Retention here means "of every recurring service on the books during year Y,
   * the share kept" — the full-year-book method adopted in the July rework. A
   * two-week slice of that isn't a smaller version of the same number, it's a
   * different (and misleading) one: almost nothing cancels in two weeks, so it
   * would read ~100%. Every retention widget names the year it is showing instead.
   *
   * The RPC returns a single composite row, not a set, so it is wrapped to keep the
   * "sources return rows" contract.
   */
  churn_summary: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_churn_summary', {
      p_company_id: ctx.companyId,
      p_year: Number(params.year),
    })
    if (error) throw new Error(`churn_summary: ${error.message}`)
    return data ? [data as ChurnSummaryRow] : []
  },

  /**
   * What was billed and collected in a window (Report §8.3).
   *
   * Aggregated in Postgres rather than pulled as rows: a year of Heroes invoices is
   * ~2,500 records, which PostgREST would hand back 1,000 at a time and then be
   * summed in Node for no benefit. One composite row instead — and it can't hit the
   * row cap as history grows.
   *
   * ⚠ Collected is derived from `outstanding_balance`, NOT `payments_total`: 177 of
   * 2,492 invoices Jobber calls paid carry payments_total = 0, so that column
   * understates collections by ~$21.7k on the same book. Full reasoning is in the
   * migration header (supabase/2026-08-11_scoreboard_invoice_reports.sql).
   */
  invoice_window: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_invoice_window', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`invoice_window: ${error.message}`)
    return data ? [data as InvoiceWindowRow] : []
  },

  /**
   * What is owed right now (Report §8.3).
   *
   * ⚠ Takes NO date range, deliberately. Accounts receivable is a point-in-time
   * fact: an invoice issued in March and still unpaid belongs in today's AR, and
   * would disappear from a June–August window — hiding most of the debt the page
   * exists to chase. The widgets built on this say "as of today" on the card rather
   * than letting the board's date picker imply something this number never obeyed.
   *
   * ⚠ "Open" means outstanding_balance > 0, never invoice_status: 14 invoices marked
   * paid still owe $3,044 between them, one of them 118 days late.
   */
  invoice_ar: async ctx => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_invoice_ar', {
      p_company_id: ctx.companyId,
    })
    if (error) throw new Error(`invoice_ar: ${error.message}`)
    return data ? [data as InvoiceArRow] : []
  },

  /**
   * Crew productivity — revenue ÷ real clocked hours (Report §8.6).
   *
   * ⚠ The RPC CLAMPS the window to where timeclock data exists and reports what it
   * clamped to. Heroes' clock starts 2026-05-29 while invoices go back to January,
   * so an unclamped year-to-date reads ~$270/labor-hour against a true ~$78. The
   * widgets print the effective period rather than the requested one — a ratio must
   * never quietly change its own denominator.
   *
   * Revenue definitions match scoreboard_techs_revenue exactly so a number means
   * the same thing here as on the technician boards.
   */
  crew_labor: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_crew_labor', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`crew_labor: ${error.message}`)
    return data ? [data as CrewLaborRow] : []
  },

  /**
   * Dialer + Txt responsiveness (Report §8.10).
   *
   * ⚠ "Missed" is derived from `answered_at`, NOT `status`: 955 inbound calls read
   * status='completed' while only 605 were ever answered — completed means the call
   * ended. Amber-handled calls count as answered.
   *
   * ⚠ No window clamping here, unlike crew_labor: every ratio divides calls by calls
   * or texts by texts, so a window predating the data is internally consistent, just
   * emptier. The earliest dates come back so a widget can say so.
   */
  communications: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_communications', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`communications: ${error.message}`)
    return data ? [data as CommsRow] : []
  },

  /**
   * Client base overview (Report §8.4).
   *
   * ⚠ Per-client spend is billed-since-the-invoice-floor, NEVER lifetime value:
   * clients date back to Jan 2025 while the invoice mirror starts at the Jobber
   * backfill floor (2026-01-02 for Heroes). The floor comes back in `coverage` so
   * every widget can name it instead of implying a complete history.
   *
   * ⚠ Leads are excluded from client counts, and there is deliberately no
   * residential/commercial split — `is_company` is set on 15 of 1,663 rows and is
   * false on known commercial accounts, so a chart built on it would be confidently
   * wrong.
   */
  clients_overview: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_clients', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`clients_overview: ${error.message}`)
    return data ? [data as ClientsRow] : []
  },

  /**
   * Customer geography by ZIP — the three heat maps on Clients.
   *
   * Jobber-native (clients, properties, jobs, invoices), deliberately NOT
   * recurring_services, which is the stale imported board.
   *
   * ⚠ ZIPs normalised to their 5-digit prefix: the mirror holds ZIP+4 forms that
   * would otherwise split one ZIP into two dots on the map.
   * ⚠ A client with several properties counts ONCE, so per-ZIP customer counts still
   * add up to the customer count.
   * ⚠ Recurring is point-in-time (who is on the book now), one-off is windowed (who
   * bought in the period) — two different questions, and each card says which.
   *
   * Verified: per-ZIP revenue sums to the whole billed book to the cent.
   */
  clients_geo: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_clients_geo', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`clients_geo: ${error.message}`)
    return data ? [data as ClientsGeoRow] : []
  },

  /**
   * Service line profitability (Report §8.8, rescoped from per-job).
   *
   * ⚠ Per-JOB margin isn't buildable: the timeclock has no job link, and visits are
   * all-day "Anytime" windows so they can't proxy time on site. Labor is instead
   * allocated by the visits each tech actually completed each day — not by their
   * department field, which is stale for at least one technician.
   *
   * ⚠ Days with no completed visits (28% of the wage bill) come back as their own
   * unassigned bucket rather than being spread or dropped, so allocated + unassigned
   * reconciles to payroll exactly.
   *
   * ⚠ Materials excluded — only a minority of line items are mapped, so charging
   * them to the mapped lines only would be an artefact. This is revenue after
   * LABOUR, not margin.
   */
  service_lines: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_service_lines', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`service_lines: ${error.message}`)
    return data ? [data as ServiceLinesRow] : []
  },

  /**
   * Sales & Pipeline from the Lead Tracker (Report §8.2, migrating the Office board).
   *
   * ⚠ Cohort = leads CREATED in the window, matching the Office board and the Board 8
   * close-rate widget so one question gets one answer everywhere.
   *
   * ⚠ Close rate counts only closed_won + closed_lost; closed_other is junk (Bad
   * Lead / Unreachable / Duplicate) and would treat wrong numbers as sales failures.
   * ⚠ Rates are withheld below 10 decided — four reps read a flawless 100% off 3–11
   * decisions before that floor went in.
   */
  sales_pipeline: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_sales', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`sales_pipeline: ${error.message}`)
    return data ? [data as SalesRow] : []
  },

  /**
   * Home's point-in-time half (Report §8.1): what needs doing, and what is booked.
   *
   * ⚠ Takes NO date window, for the same reason invoice_ar doesn't. "Work sitting
   * unbilled" and "visits that never happened" are facts about today; a date picker
   * above them would imply a filter they never obeyed.
   *
   * ⚠ "Late" is derived from the FACT (scheduled in the past, never completed), not
   * from visit_status — Jobber's own label disagrees with itself here, marking two
   * future-dated visits LATE while leaving June visits UPCOMING.
   *
   * ⚠ The at-risk count keys off `cancelled_status = 'Active'`, not the sold status
   * alone: 153 of the 474 leads reading "Sold" are CANCELLED, and filtering on Sold
   * alone inflated this from 22 customers to 128.
   *
   * ⚠ Booked work is scheduled-and-priced work, NOT a churn-adjusted forecast, and
   * it is a floor: 250 of 1,910 scheduled visits carry no line item to price.
   */
  home_pulse: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_home_pulse', {
      p_company_id: ctx.companyId,
      p_months: Number(params.months) || 6,
    })
    if (error) throw new Error(`home_pulse: ${error.message}`)
    return data ? [data as HomePulseRow] : []
  },

  leads_decided: async (ctx, params) => {
    const { data, error } = await ctx.supabase
      .from('leads')
      .select('lead_source, stage')
      .eq('company_id', ctx.companyId)
      .gte('lead_creation_date', String(params.start))
      .lte('lead_creation_date', String(params.end))
    if (error) throw new Error(`leads_decided: ${error.message}`)
    return (data ?? []) as DecidedLeadRow[]
  },
}

export function getSourceExecutor(key: SourceKey): SourceExecutor | null {
  return SOURCES[key] ?? null
}

export const SOURCE_KEYS = Object.keys(SOURCES) as SourceKey[]
