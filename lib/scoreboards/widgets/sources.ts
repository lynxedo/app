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
  /** Who is looking. Sources that return per-person data mark their row. */
  viewerUserId: string
  /**
   * Whether this viewer may see OTHER people's performance.
   *
   * ⚠ People Performance is the one report anyone with Hub access can open,
   * because it is how a person sees their own numbers. Everything about a
   * colleague is withheld unless this is true. The narrowing happens in the
   * source, server-side, before any payload is built — never in the component.
   */
  canSeeOthersPerformance: boolean
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

/** One target and how it is tracking. ⚠ `expected_by_now` is null for rate metrics. */
export type GoalRow = {
  id: string
  metric: string
  grain: 'month' | 'quarter' | 'year'
  period_start: string
  period_end: string
  target: number
  /** Null when the metric key is unknown or the period has no data. */
  actual: number | null
  attainment_pct: number | null
  elapsed_pct: number
  /**
   * The prorated target for today. ⚠ NULL for a rate metric, deliberately —
   * a close rate does not accumulate, so "you should be at 48% of your close
   * rate by now" would be nonsense. See lib/reports/goals.ts.
   */
  expected_by_now: number | null
  cumulative: boolean
  closed: boolean
  /**
   * ⚠ 'under' is the RATE equivalent of 'behind'. A rate has no pace to fall
   * behind, so it is compared straight to the target. 'open' means only that
   * the period has not begun — it used to also catch rates mid-period, which
   * made a live target read "Not started".
   */
  status: 'hit' | 'missed' | 'on_track' | 'behind' | 'under' | 'open' | 'unknown'
  /**
   * Null on a company-wide target; set when this target belongs to one person.
   *
   * ⚠ Keyed on `employees.id`, never a name — the Crew and People reports spell
   * the same person differently ("Mike Cyplik" vs "Mike"), so a name could not
   * match both sources. Same key `commission_plans` uses.
   */
  employee_id: string | null
  /**
   * Whose target it is, for display. Composed from the roster rather than the
   * figures, so a target set for somebody with no activity in the period still
   * says whose it is instead of rendering an anonymous "no data" row.
   */
  person_name: string | null
}

export type GoalsRow = {
  as_of: string
  goals: GoalRow[]
  /** Everything overlapping the window, so a truncated list can say so. */
  total_in_window: number
  shown: number
}

/** One person's own scorecard. ⚠ Carries no pay — see scoreboard_people. */
export type Person = {
  user_id: string | null
  employee_id: string
  name: string
  department: string | null
  is_active: boolean
  is_field_labor: boolean
  /** True on the row belonging to whoever is looking at the report. */
  is_viewer: boolean
  sales: {
    leads: number
    /** Everything counted as a sale: Closed Won plus every stage ticked "Sold". */
    won: number
    /** Closed Won alone — a deal competed for, with no upsells in it. */
    competed_won: number
    /** The "Sold" stages alone — the Lead Tracker's Upsells section. */
    upsold: number
    decided: number
    /** Null below the fair-rating floor — see `rate_min_sample`. */
    close_rate: number | null
    /** Annual value of everything counted as a sale, upsells included. */
    sold_value: number
    /** Annual value of the upsells alone. `sold_value` minus this is new business. */
    upsold_value: number
    avg_deal: number | null
  }
  field: {
    hours: number
    revenue: number | null
    rev_per_hour: number | null
    /** False for salaried staff and anyone under an hour. */
    rankable: boolean
    /** False when nobody in Jobber matches them, so no work can be credited. */
    attributable: boolean
  }
  phone: {
    /** A fact. ⚠ There is deliberately no personal answer RATE — see below. */
    calls_answered: number
    calls_placed: number
    median_answer_sec: number | null
    texts_sent: number
  }
}

/**
 * People Performance (§8.7) — one row per person, plus the context that makes a
 * personal number fair to read.
 *
 * ⚠ `people` is narrowed to the viewer alone unless they hold the report grant.
 * ⚠ The office block exists because the answer RATE is an office outcome, not a
 *   personal one: `calls.handled_by` is a routing stamp written before the call
 *   is offered, so "answered ÷ routed" would libel whoever the line points at.
 */
export type PeopleRow = {
  scope: 'self' | 'team'
  coverage: CrewLaborRow['coverage']
  /** Minimum decided leads before a close rate is shown at all. */
  rate_min_sample: number
  people: Person[]
  departments: {
    department: string
    people: number
    hours: number
    revenue: number
    rev_per_hour: number | null
  }[]
  office: {
    inbound_calls: number
    missed: number
    missed_pct: number | null
    median_answer_sec: number | null
    texts_in: number
    texts_out: number
    median_reply_sec: number | null
  }
  /** Salesperson names that matched nobody, or matched more than one person. */
  unmatched_sales: { name: string; leads: number; won: number; sold_value: number }[]
  /**
   * Lead Tracker stage keys ticked "counts as a sale" — the Upsells section.
   * ⚠ Empty means no stage is ticked, so every per-person `upsold` figure is
   * legitimately zero. A card paying on upsells must say that rather than show a $0
   * that reads as "they sold nothing".
   */
  sale_stages: string[]
}

/**
 * Sales per salesperson per time bucket — the source behind "Sales by Person over Time".
 *
 * ⚠ `k` is the salesperson's NAME, not an id: `leads.salesperson` is free text and
 * there is nothing stable to key on. It is normalised exactly the way
 * `scoreboard_sales` normalises it, so one person can never appear as two bars.
 *
 * ⚠ Unlike the per-technician revenue trend, the segments DO add up to the period
 * total — a lead has exactly one salesperson, so nothing is credited twice.
 */
export type SalesPersonTrendRow = {
  grain: 'month' | 'week'
  start: string
  end: string
  periods: { b: string; total: number; count: number }[]
  /** One row per (bucket, salesperson). */
  people: { b: string; k: string; name: string; total: number; count: number }[]
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
/**
 * Visit revenue bucketed by month or week, split three ways (company / service
 * line / technician). Populated by `scoreboard_visit_revenue_trend`.
 *
 * ⚠ `lines` sums exactly to `periods`; `techs` does NOT when tech_credit is
 * 'each' — a visit with two technicians credits both, so the per-tech series
 * overshoots by `shared_overlap`. That is reported rather than hidden so a
 * stacked chart can say why. See the RPC's header comment for the measurement.
 */
export type RevenueTrendRow = {
  grain: 'month' | 'week'
  tech_credit: 'each' | 'split'
  start: string
  end: string
  total: number
  periods: { b: string; total: number; visits: number }[]
  /** One row per (bucket, service line). */
  lines: { b: string; k: string; total: number }[]
  /** One row per (bucket, technician). `k` is the Jobber user id. */
  techs: { b: string; k: string; name: string; total: number }[]
  shared_visits: number
  /** Dollars the per-tech series counts more than once. 0 when credit is 'split'. */
  shared_overlap: number
  /** Revenue on visits with nobody assigned — invisible to the per-tech series. */
  unattributed_revenue: number
  unattributed_visits: number
}

/**
 * Lead Tracker Service values, counted per salesperson — the tracked-item source.
 *
 * `rows` carries RAW service values, one row per (value, salesperson). Folding the
 * spellings of one product together happens in the widget so it stays visible and
 * undoable; see trackeditems.ts.
 */
export type LeadItemsRow = {
  basis: 'sold' | 'created'
  start: string
  end: string
  stages: string[]
  rows: { value: string; salesperson: string | null; leads: number }[]
  coverage: {
    /** Leads in the window matching the stage filter. */
    leads: number
    /** Of those, how many carry no Service value at all — they can match nothing. */
    no_service: number
    /** Leads listing more than one service, so per-item counts sum above the lead count. */
    multi_service: number
    no_salesperson: number
    /** Oldest/newest date this company has on the chosen basis — the data floor. */
    earliest: string | null
    latest: string | null
  }
}

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
  /**
   * Everything SOLD — `closed_won` plus any stage the tenant marked
   * `counts_as_sale` in Admin → Lead Tracker (Heroes ticks Upsells).
   *
   * ⚠⚠ This moved on 2026-08-17 and the reason is worth keeping. Before, anything
   * that was not won/lost/junk counted as STILL OPEN, so Heroes' 55 sold upsells sat
   * in Open Pipeline forever and their $31,541 was missing from Value Sold — the old
   * Main board counted them, so the two disagreed by 15% on "what did we sell".
   */
  won: number
  /** Sold in open competition (`closed_won` only) — the close-rate numerator. */
  competed_won: number
  /** Sold without competing: the counts_as_sale stages. */
  upsold: number
  upsold_value: number
  /** Which stages the tenant counts as a sale. Cards name them rather than assuming. */
  sale_stages: string[]
  lost: number
  decided: number
  open: number
  /** Bad Lead / Unreachable / Duplicate — excluded from close rate, reported anyway. */
  excluded_junk: number
  /**
   * ⚠ Competed-only basis, deliberately UNCHANGED by counts_as_sale: an upsell to an
   * existing customer is not a lead you competed for, so it must not move the rate
   * (Ben's call). Time-to-close stays on the same basis for the same reason.
   */
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
  by_month: {
    month: string; leads: number; won: number; competed_won: number; upsold: number
    decided: number; won_value: number; competed_value: number; upsold_value: number
    close_rate: number | null
  }[]
  by_source: {
    source: string; leads: number; won: number; competed_won: number; upsold: number
    decided: number; close_rate: number | null; value: number
  }[]
  by_salesperson: {
    name: string; leads: number; won: number; decided: number; close_rate: number | null
    value: number; upsold: number; upsold_value: number
  }[]
  lost_reasons: { reason: string; count: number }[]
  open_by_stage: { stage: string; count: number }[]
}

/**
 * Jobber quotes SENT in the window (§8.2's quote half).
 *
 * ⚠ No dollar fields, deliberately — Jobber's quote total counts only non-optional
 * line items and Heroes quotes options constantly, so a total is meaningless here.
 * ⚠ Won keys off the STATUS, not approved_at: 28 of 113 converted quotes have no
 * approval timestamp because they were sold in person.
 */
export type QuoteCohortRow = {
  sent: number
  won: number
  lost: number
  decided: number
  still_open: number
  /** Converted without ever being sent — counted, and named on the card. */
  sold_on_the_spot: number
  viewed: number
  never_viewed: number
  no_salesperson: number
  /** Minimum decided quotes before a win rate is shown at all. */
  rate_min_sample: number
  win_rate: number | null
  median_days_to_win: number | null
  win_time_sample: number
  by_month: { month: string; sent: number; won: number; decided: number; win_rate: number | null }[]
  by_salesperson: { rep_id: string; name: string; sent: number; won: number; decided: number; win_rate: number | null }[]
  by_service: { code: string; sent: number; won: number; decided: number; win_rate: number | null }[]
}

/**
 * Quotes unanswered RIGHT NOW. No window, for the same reason invoice_ar has none:
 * a quote sent in June that nobody answered belongs in today's chase list and would
 * vanish from an August window — and the stale ones are the ones worth chasing.
 */
export type QuoteOpenRow = {
  as_of: string
  open_total: number
  /** ⚠ Requires a real sent_at — a quote sold on the spot was never sent to anyone. */
  never_opened: number
  opened_no_reply: number
  oldest_days: number | null
  /** Watchdog: customer approved and it never became a job. 0 is the healthy answer. */
  approved_not_converted: number
  aging: { d0_7: number; d8_14: number; d15_30: number; d31: number }
  list_cap: number
  list_total: number
  list: {
    quote_number: string | null
    client: string
    /** Jobber-mirror client id, for the click-through to the customer file. */
    client_id: string | null
    days_out: number
    viewed: boolean
    service: string
    salesperson: string
    jobber_uri: string | null
  }[]
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

/**
 * One row per (active recurring job, base-program line).
 *
 * ⚠ `addon_names` carries whatever the tenant flagged `is_auxiliary` in
 * `recurring_program_definitions`, NOT a fixed pair of columns. The function still
 * returns `has_phc` / `has_bwp` for the legacy hardcoded WF board; widgets must
 * never read those two — they are two Heroes line-item names baked into SQL and are
 * always false for any other tenant.
 *
 * ⚠ `is_priced` is false when the base program has no visits-per-year set, which
 * means `annual_value` is 0 because nobody filled a field — not because the work is
 * worthless. All ten Heroes Mosquito jobs are in that state, so any card summing
 * value has to be able to say how many jobs it could not price.
 */
export type RecurringBookRow = {
  job_id: string
  client_id: string
  dept_prefix: string | null
  display_name: string | null
  annual_value: number | string | null
  addon_names: string[] | null
  visits_per_year: number | null
  is_priced: boolean
}

export type TicketSizeRow = {
  ticket_count: number
  avg_value: number | string | null
  median_value: number | string | null
  total_value: number | string | null
  by_line: {
    line: string
    ticket_count: number
    avg_value: number | string | null
    median_value: number | string | null
    total_value: number | string | null
  }[]
}

/**
 * One bonus rule. See lib/reports/commission.ts for what each field means and how it
 * pays; this is only the row shape.
 *
 * ⚠ Carries `employee_id`, never a name. The three data sets a commission can be
 * based on spell people differently, and `scoreboard_people` already reconciles all
 * three onto the roster — so the commission figure and that person's People card
 * agree by construction instead of via a second matching rule that can drift.
 */
export type CommissionPlanRow = {
  id: string
  employee_id: string
  label: string
  basis: string
  rate_kind: string
  rate: number | string | null
  tiers: unknown
  threshold: number | string | null
  cap: number | string | null
  line_prefix: string | null
  items: string[] | null
  active: boolean
  sort_order: number
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
   * Visit revenue over time — what the crews produced, month by month or week by
   * week, split by service line and by technician (§8.8 / §8.6 companion).
   *
   * ⚠ This is VISIT revenue (Jobber line items on completed visits), NOT invoiced
   * money. The Revenue report's "Invoiced vs Collected by Month" measures a
   * different thing and the two will not tie — every widget built on this says so.
   *
   * ⚠ Deliberately NOT clamped to timeclock coverage, unlike `service_lines` and
   * `crew_labor`. Those clamp because they divide revenue by labour hours; this
   * reports revenue alone, and clamping would silently start a year-to-date chart
   * in late May.
   */
  visit_revenue_trend: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_visit_revenue_trend', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
      p_grain: String(params.grain ?? 'month'),
      p_tech_credit: String(params.tech_credit ?? 'each'),
    })
    if (error) throw new Error(`visit_revenue_trend: ${error.message}`)
    return data ? [data as RevenueTrendRow] : []
  },

  /**
   * ⚠ `stages` arrives as a comma-joined string because SourceParams holds only
   * scalars (it has to — `sourceKey` stringifies params to build the dedupe key, and
   * an array would key by object identity and split the cache slot every render).
   * Split back to the text[] the function wants.
   */
  lead_items: async (ctx, params) => {
    const stages = String(params.stages ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_lead_items', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
      p_basis: String(params.basis ?? 'sold'),
      p_stages: stages.length ? stages : null,
    })
    if (error) throw new Error(`lead_items: ${error.message}`)
    return data ? [data as LeadItemsRow] : []
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
  /**
   * The people figures behind the Commission cards — the SAME RPC as `people`, but
   * never narrowed to the viewer.
   *
   * ⚠⚠ WHY THIS EXISTS AS A SEPARATE SOURCE. `people` self-narrows to the viewer's
   * own row unless the caller holds the People "team view" grant, and the custom
   * scoreboard route hardcodes that to false on purpose — a board carries no
   * per-report grant, so People-shaped data must fail closed there. Commission read
   * `people`, so on a custom board every plan belonging to anyone but the viewer was
   * dropped as "orphaned" and the cards showed $0. The privacy narrowing is right for
   * People Performance and wrong for Commission, which is by definition a manager
   * looking at other people's pay.
   *
   * ⚠ Safe because the commission widgets answer to the Crew & Labor grant and a
   * restricted widget is dropped BEFORE the resolver runs — so a viewer without that
   * grant never reaches this source at all. It must therefore only ever be requested
   * by Crew-&-Labor-gated widgets; anything else would be a side door around the
   * People self-scope.
   *
   * ⚠ A DISTINCT source name is also what makes it work: the resolver dedupes on
   * (source, params), so a board carrying a People card and a Commission card gets
   * the narrowed list for one and the full list for the other. Sharing the name would
   * hand whichever ran first to both.
   */
  commission_people: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_people', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`commission_people: ${error.message}`)
    if (!data) return []
    const row = data as Omit<PeopleRow, 'scope'> & { people: Omit<Person, 'is_viewer'>[] }
    return [{
      ...row,
      scope: 'team',
      people: (row.people ?? []).map(p => ({ ...p, is_viewer: p.user_id != null && p.user_id === ctx.viewerUserId })),
    } as PeopleRow]
  },

  sales_person_trend: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_sales_person_trend', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
      p_grain: String(params.grain ?? 'month'),
    })
    if (error) throw new Error(`sales_person_trend: ${error.message}`)
    return data ? [data as SalesPersonTrendRow] : []
  },

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
   * Jobber quotes sent in the window — the quote half of Report §8.2.
   *
   * ⚠ Counts only. Jobber's `amounts.total` excludes optional line items and Heroes
   * quotes options constantly (a $14,175 quote reporting $0.00), so no dollar figure
   * on a quote can be trusted; Ben's call is to count quotes instead.
   * ⚠ A quote is won by its STATUS, never by having an approval timestamp — 28 of 113
   * converted quotes carry none because they were sold in person and converted straight
   * to a job. Timestamps here only ever measure timing.
   */
  quotes_cohort: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_quotes', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`quotes_cohort: ${error.message}`)
    return data ? [data as QuoteCohortRow] : []
  },

  /**
   * Quotes unanswered as of today. Takes NO date window, for the same reason
   * `invoice_ar` doesn't: an unanswered quote sent in June belongs in today's chase
   * list and would disappear from an August window, and the stale ones are precisely
   * the ones worth chasing. Every card built on this says "as of today" on its face.
   */
  quotes_open: async (ctx) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_quotes_open', {
      p_company_id: ctx.companyId,
    })
    if (error) throw new Error(`quotes_open: ${error.message}`)
    return data ? [data as QuoteOpenRow] : []
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

  /**
   * ⚠⚠ THE NARROWING BELOW IS THE PERMISSION BOUNDARY FOR THIS REPORT.
   *
   * People Performance is openable by anyone with Hub access, so that a person
   * can see their own numbers. Everyone else's row is stripped HERE — in the
   * source, before any payload exists — rather than hidden in a component,
   * where it would still have been sent to the browser.
   */
  people: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_people', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`people: ${error.message}`)
    if (!data) return []

    const row = data as Omit<PeopleRow, 'scope'> & { people: Omit<Person, 'is_viewer'>[] }
    const mark = (p: Omit<Person, 'is_viewer'>): Person => ({
      ...p,
      is_viewer: p.user_id != null && p.user_id === ctx.viewerUserId,
    })
    const people = (row.people ?? []).map(mark)

    if (ctx.canSeeOthersPerformance) {
      return [{ ...row, scope: 'team', people } as PeopleRow]
    }
    return [{
      ...row,
      scope: 'self',
      people: people.filter(p => p.is_viewer),
      // Which names failed to match a person is an attribution gap for whoever
      // manages the board, not something to show a technician their own card.
      unmatched_sales: [],
    } as PeopleRow]
  },

  goals: async (ctx, params) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_goals', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
    })
    if (error) throw new Error(`goals: ${error.message}`)
    return data ? [data as GoalsRow] : []
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

  /**
   * The active recurring book (Jobber jobs + line items + the tenant's program
   * definitions).
   *
   * ⚠ TAKES NO PARAMETERS AT ALL, deliberately — not even a date window. It is a
   * point-in-time picture of what is on the books right now, the same reason
   * `invoice_ar` takes no dates: an "active customers" count for a window in March
   * is not a smaller version of the same number, it is a different question the data
   * cannot answer. Every card built on it says "as things stand today" rather than
   * quietly ignoring the date picker above it.
   *
   * The no-parameter shape also means every book card on a board — WF count, IR
   * value, program mix, attach rate — shares ONE cache slot and therefore one query.
   */
  recurring_book: async (ctx) => {
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_recurring_book', {
      p_company_id: ctx.companyId,
    })
    if (error) throw new Error(`recurring_book: ${error.message}`)
    return (data ?? []) as RecurringBookRow[]
  },

  /**
   * What a single completed job is worth, per service line.
   *
   * ⚠ `lines` and `exclude` arrive comma-joined for the same reason `lead_items`
   * joins its stages: SourceParams holds only scalars, because `sourceKey`
   * stringifies params to build the dedupe key and an array would key by object
   * identity, splitting the cache slot on every render.
   *
   * ⚠ Which names are excluded IS the definition of the measure — a service plan, an
   * install and a drainage job are not repair tickets — so the exclusion list is
   * part of the cache key and two cards excluding different things correctly cost
   * two queries.
   */
  /**
   * The bonus rules for this company.
   *
   * ⚠ TAKES NO DATE WINDOW: a plan is a standing rule, not an event. Which period it
   * is measured over comes from the board's date range and is applied to the BASIS,
   * not to the rule.
   *
   * ⚠ Read through the SERVICE-ROLE client, not the caller's, because
   * `commission_plans` is RLS-on-with-no-policies — pay data, same shape as
   * report_goals. The route has already checked the caller's report grant, and the
   * query scopes by company itself. See the two-clients warning at the top of this
   * file: there is no second net below the route.
   *
   * ⚠ Inactive plans are returned rather than filtered. A rule someone switched off
   * mid-period still explains why a figure moved, and the cards can say "2 rules are
   * switched off" instead of silently dropping them.
   */
  commission_plans: async (ctx) => {
    const { data, error } = await ctx.rpcClient
      .from('commission_plans')
      .select('id, employee_id, label, basis, rate_kind, rate, tiers, threshold, cap, line_prefix, items, active, sort_order')
      .eq('company_id', ctx.companyId)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(`commission_plans: ${error.message}`)
    return (data ?? []) as CommissionPlanRow[]
  },

  ticket_size: async (ctx, params) => {
    const split = (v: unknown) =>
      String(v ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const lines = split(params.lines)
    const exclude = split(params.exclude)
    const { data, error } = await ctx.rpcClient.rpc('scoreboard_ticket_size', {
      p_company_id: ctx.companyId,
      p_start: String(params.start),
      p_end: String(params.end),
      p_lines: lines.length ? lines : null,
      p_exclude: exclude.length ? exclude : null,
    })
    if (error) throw new Error(`ticket_size: ${error.message}`)
    return data ? [data as TicketSizeRow] : []
  },
}

export function getSourceExecutor(key: SourceKey): SourceExecutor | null {
  return SOURCES[key] ?? null
}

export const SOURCE_KEYS = Object.keys(SOURCES) as SourceKey[]
