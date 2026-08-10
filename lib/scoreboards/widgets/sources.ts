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

/* ── Executors ──────────────────────────────────────────────────────────── */

const SOURCES: Record<SourceKey, SourceExecutor> = {
  /**
   * Lead-source scorecard: per-source volume, value and loyalty over the
   * recurring book.
   *
   * ⚠ This RPC takes a YEAR, not a date range (`p_year`), so an arbitrary window
   * is narrowed to the year it ends in. Widening it to (p_start, p_end) is
   * tracked in REPORTS_PRD.md §9.1.4a — it is also the RPC that hit an 8.5s
   * statement timeout in July before its functional indexes landed, so re-check
   * timing on wide ranges when that widening happens.
   */
  source_scorecard: async (ctx, params) => {
    const { data, error } = await ctx.supabase.rpc('scoreboard_source_scorecard', {
      p_company_id: ctx.companyId,
      p_year: Number(params.year),
    })
    if (error) throw new Error(`source_scorecard: ${error.message}`)
    return (data ?? []) as ScorecardRow[]
  },

  /**
   * Lead Tracker leads CREATED in the window that have since been decided.
   * Cohort basis (created-in-window, not decided-in-window) matches how the
   * Office board already reports close rate, so the two agree.
   */
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
