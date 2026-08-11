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
 */

import type { createClient } from '@/lib/supabase/server'
import type { SourceKey, SourceParams } from './types'

type ServerClient = Awaited<ReturnType<typeof createClient>>

export type SourceContext = {
  supabase: ServerClient
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
    const { data, error } = await ctx.supabase.rpc('scoreboard_source_scorecard_range', {
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
    const { data, error } = await ctx.supabase.rpc('scoreboard_churn_summary', {
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
    const { data, error } = await ctx.supabase.rpc('scoreboard_invoice_window', {
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
    const { data, error } = await ctx.supabase.rpc('scoreboard_invoice_ar', {
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
    const { data, error } = await ctx.supabase.rpc('scoreboard_crew_labor', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`crew_labor: ${error.message}`)
    return data ? [data as CrewLaborRow] : []
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
