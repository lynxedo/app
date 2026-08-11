/* Crew & Labor Efficiency widgets — the library behind Report §8.6.
 *
 * The flagship differentiator: revenue (Jobber) ÷ real clocked hours (Hub
 * timeclock). A Jobber-only competitor cannot compute this at all, because it
 * never sees the timeclock.
 *
 * ⚠ Everything here reports the EFFECTIVE period, not the requested one. The
 * timeclock starts 2026-05-29 while invoices go back to January, so a
 * year-to-date request would otherwise divide seven months of revenue by three
 * months of hours and read ~$270/hr instead of ~$78. The source clamps the window
 * to where clock data actually exists; these widgets say so on the card whenever
 * it happened. A ratio that quietly changes its own denominator is the exact
 * failure this product claims to beat.
 *
 * Three more guards, each from a real row in the live data:
 *   - Someone with hours but no Jobber identity is counted in hours and cost (they
 *     were really paid) but carries no $/hour, and is named — not silently dropped,
 *     which would flatter everyone else's ratio.
 *   - Departed employees keep their hours. History doesn't change when someone leaves.
 *   - Salaried staff and anyone under an hour are unrankable: the GM had 0.02 stray
 *     clock hours against real assigned visits, which computed to $339,350/hour.
 */

import { formatCurrency } from '@/lib/format'
import type { CrewLaborRow, CrewPerson } from './sources'
import type { SourceBag, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

const crewReq = (win: WindowSpec) => ({
  source: 'crew_labor' as const,
  params: { start: win.start, end: win.end },
})

function crew(bag: SourceBag, win: WindowSpec): CrewLaborRow | null {
  return bag.get<CrewLaborRow>(crewReq(win))[0] ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pretty(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * The phrase every card uses instead of the window's own label.
 *
 * When the source had to narrow the window, saying the requested range would be a
 * lie about which days the number covers — so the card names the days it actually
 * measured and why.
 */
function periodPhrase(r: CrewLaborRow | null, win: WindowSpec): string {
  if (!r || !r.coverage.has_data) return win.phrase
  const { effective_start, effective_end, clamped } = r.coverage
  const span = `${pretty(effective_start)} – ${pretty(effective_end)}`
  return clamped ? `${span} (where clock data exists)` : span
}

function rankable(r: CrewLaborRow | null): CrewPerson[] {
  return (r?.people ?? []).filter(p => p.rankable && p.rev_per_hour != null)
}

export const CREW_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    /* ★ The headline. */
    type: 'kpi_revenue_per_labor_hour',
    group: 'Crew & Labor',
    title: 'Revenue per Labor Hour',
    blurb: 'What every clocked hour brings in',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      const v = r?.rev_per_hour
      return {
        kind: 'kpi',
        label: 'Revenue per Labor Hour',
        value: v != null ? `${formatCurrency(num(v))}/hr` : '—',
        tone: v == null ? 'neutral' : num(v) >= 75 ? 'good' : num(v) >= 50 ? 'warn' : 'bad',
        sub: r && r.coverage.has_data
          ? `${formatCurrency(num(r.revenue))} of work ÷ ${num(r.hours).toLocaleString()} clocked hours · ${periodPhrase(r, win)}`
          : 'No timeclock data for this period',
      }
    },
  },

  {
    type: 'kpi_labor_hours',
    group: 'Crew & Labor',
    title: 'Hours Clocked',
    blurb: 'Total field hours actually worked',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      const n = (r?.people ?? []).length
      return {
        kind: 'kpi',
        label: 'Hours Clocked',
        value: r && r.coverage.has_data ? num(r.hours).toLocaleString() : '—',
        sub: r && r.coverage.has_data
          ? `${n} ${n === 1 ? 'person' : 'people'} on the clock · ${periodPhrase(r, win)}`
          : 'No timeclock data for this period',
      }
    },
  },

  {
    type: 'kpi_labor_cost_pct',
    group: 'Crew & Labor',
    title: 'Labor Cost % of Revenue',
    blurb: 'Share of the work that went to field wages',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      const p = r?.labor_pct
      return {
        kind: 'kpi',
        label: 'Labor Cost % of Revenue',
        value: p != null ? `${num(p)}%` : '—',
        // Field labor in this trade typically runs 25–35%; above 40 is a warning.
        tone: p == null ? 'neutral' : num(p) <= 30 ? 'good' : num(p) <= 40 ? 'warn' : 'bad',
        // ⚠ Named precisely: salaried staff don't clock, so this is field wages,
        // not total payroll. Calling it "labor cost" flat would overstate margin.
        sub: r
          ? `${formatCurrency(num(r.labor_cost))} in hourly field wages · salaried staff not included`
          : 'No timeclock data for this period',
      }
    },
  },

  {
    type: 'kpi_revenue_per_visit',
    group: 'Crew & Labor',
    title: 'Revenue per Visit',
    blurb: 'Average value of a completed visit',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      return {
        kind: 'kpi',
        label: 'Revenue per Visit',
        value: r?.rev_per_visit != null ? formatCurrency(num(r.rev_per_visit)) : '—',
        sub: r && r.coverage.has_data
          ? `${num(r.visits).toLocaleString()} visits completed · ${periodPhrase(r, win)}`
          : 'No completed visits in this period',
      }
    },
  },

  {
    /* ★ The chart that makes the point. */
    type: 'crew_rev_per_hour_ranking',
    group: 'Crew & Labor',
    title: 'Revenue per Hour by Technician',
    blurb: 'Who turns clocked time into the most work',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      const rows = rankable(r)
        .slice()
        .sort((a, b) => num(b.rev_per_hour) - num(a.rev_per_hour))
        .map(p => ({
          label: p.name,
          value: num(p.rev_per_hour),
          tone: (num(p.rev_per_hour) >= 100 ? 'good' : num(p.rev_per_hour) >= 50 ? 'warn' : 'bad') as Tone,
          detail: `${formatCurrency(num(p.revenue))} over ${num(p.hours).toLocaleString()} hrs${p.is_active ? '' : ' · no longer employed'}`,
        }))
      const skipped = (r?.people ?? []).filter(p => !p.rankable)
      return {
        kind: 'bars',
        title: 'Revenue per Hour by Technician',
        sub: periodPhrase(r, win),
        format: 'currency',
        rows,
        // Naming who is missing and why is the difference between a ranking and a
        // misleading one — a hidden denominator makes everyone else look better.
        legend: skipped.length
          ? [{ label: `${skipped.length} not ranked: ${skipped.map(p => p.name).join(', ')}`, tone: 'unknown' as Tone }]
          : undefined,
        empty: 'Nobody has both clocked hours and attributed work in this period',
      }
    },
  },

  {
    type: 'crew_hours_by_person',
    group: 'Crew & Labor',
    title: 'Hours by Person',
    blurb: 'Who is putting in the time',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      const rows = (r?.people ?? [])
        .filter(p => num(p.hours) > 0)
        .map(p => ({
          label: p.name,
          value: num(p.hours),
          tone: (p.is_active ? 'neutral' : 'unknown') as Tone,
          detail: p.labor_cost != null
            ? `${formatCurrency(num(p.labor_cost))} in wages${p.is_active ? '' : ' · no longer employed'}`
            : 'Salaried — hours logged but not costed here',
        }))
      return {
        kind: 'bars',
        title: 'Hours by Person',
        sub: `${periodPhrase(r, win)} · includes people who have since left`,
        format: 'number',
        rows,
        empty: 'No hours clocked in this period',
      }
    },
  },

  {
    type: 'crew_hours_by_department',
    group: 'Crew & Labor',
    title: 'Hours by Department',
    blurb: 'Where the labor is going',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      const parts = (r?.by_department ?? [])
        .filter(d => num(d.hours) > 0)
        .map(d => ({
          label: d.department,
          value: Math.round(num(d.hours)),
          tone: (d.department === 'Unassigned' ? 'unknown' : 'neutral') as Tone,
        }))
      const unassigned = (r?.by_department ?? []).find(d => d.department === 'Unassigned')
      return {
        kind: 'donut',
        title: 'Hours by Department',
        sub: `${periodPhrase(r, win)} · by clocked hours`,
        parts,
        note: unassigned
          ? `"Unassigned" is ${num(unassigned.hours).toLocaleString()} hours from people with no department set on their employee record — worth filling in so this splits properly.`
          : undefined,
        empty: 'No hours clocked in this period',
      }
    },
  },

  {
    type: 'crew_labor_table',
    group: 'Crew & Labor',
    title: 'Crew Detail',
    blurb: 'Hours, wages and work per person',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      const rows = (r?.people ?? []).map(p => ({
        key: p.employee_id,
        cells: {
          name: p.name,
          department: p.department,
          hours: num(p.hours),
          cost: p.labor_cost != null ? num(p.labor_cost) : null,
          revenue: p.revenue != null ? num(p.revenue) : null,
          perhour: p.rev_per_hour != null ? num(p.rev_per_hour) : null,
        },
        tones: p.rev_per_hour != null
          ? { perhour: (num(p.rev_per_hour) >= 100 ? 'good' : num(p.rev_per_hour) >= 50 ? 'warn' : 'bad') as Tone }
          : undefined,
        meta: !p.attributable
          ? { text: 'No matching Jobber user — work cannot be credited to them', tone: 'unknown' as Tone }
          : !p.rankable
            ? { text: p.pay_type === 'hourly' ? 'Under an hour clocked — ratio not meaningful' : 'Salaried — does not clock hours', tone: 'unknown' as Tone }
            : !p.is_active
              ? { text: 'No longer employed — hours kept for this period', tone: 'neutral' as Tone }
              : undefined,
      }))
      return {
        kind: 'table',
        title: 'Crew Detail',
        sub: periodPhrase(r, win),
        columns: [
          { key: 'name', label: 'Person', align: 'left' },
          { key: 'department', label: 'Department', align: 'left' },
          { key: 'hours', label: 'Hours', align: 'right', format: 'number', sortable: true },
          { key: 'cost', label: 'Wages', align: 'right', format: 'currency' },
          { key: 'revenue', label: 'Work completed', align: 'right', format: 'currency' },
          { key: 'perhour', label: '$ / hour', align: 'right', format: 'currency', sortable: true },
        ],
        rows,
        /* A visit staffed by two people credits both in full — the convention the
         * existing technician boards already use. Saying so is cheaper than a
         * silent split that makes per-person figures not tie to the company total. */
        foot: 'Work completed credits every technician assigned to a visit, so a two-person visit counts for both and the column sums to more than company revenue.',
        empty: 'No hours clocked in this period',
      }
    },
  },

  {
    type: 'crew_insights',
    group: 'Crew & Labor',
    title: 'What the Numbers Say',
    blurb: 'Plain-language read of crew productivity',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, _cfg, win) => {
      const r = crew(bag, win)
      const items: string[] = []

      if (!r || !r.coverage.has_data || num(r.hours) === 0) {
        return {
          kind: 'list',
          title: 'What the Numbers Say',
          sub: '',
          items: [],
          empty: 'No timeclock data overlaps this date range',
        }
      }

      /* The most important line on the page when it applies: without it the
       * headline number silently answers a different question than the one the
       * date picker implies. */
      if (r.coverage.clamped) {
        items.push(`These figures cover ${pretty(r.coverage.effective_start)} – ${pretty(r.coverage.effective_end)}, not the full range you picked. The timeclock only has data from ${pretty(r.coverage.timeclock_first)}, and dividing a longer stretch of revenue by a shorter stretch of hours would overstate revenue per hour — badly.`)
      }

      items.push(`${formatCurrency(num(r.revenue))} of completed work against ${num(r.hours).toLocaleString()} clocked hours — ${r.rev_per_hour != null ? formatCurrency(num(r.rev_per_hour)) : '—'} per labor hour, across ${num(r.visits).toLocaleString()} visits.`)

      if (r.labor_pct != null) {
        items.push(`Hourly field wages were ${formatCurrency(num(r.labor_cost))}, or ${num(r.labor_pct)}% of the work completed. Salaried staff aren't in that figure, so true payroll load is higher.`)
      }

      const ranked = rankable(r).slice().sort((a, b) => num(b.rev_per_hour) - num(a.rev_per_hour))
      if (ranked.length >= 2) {
        const top = ranked[0], bottom = ranked[ranked.length - 1]
        items.push(`${top.name} leads at ${formatCurrency(num(top.rev_per_hour))} per hour; ${bottom.name} is lowest at ${formatCurrency(num(bottom.rev_per_hour))}. Different services carry different price tags, so compare people doing the same kind of work before drawing conclusions.`)
      }

      if (num(r.unattributed_count) > 0) {
        const names = (r.unattributed_names ?? []).join(', ')
        items.push(`⚠ ${names} clocked ${num(r.unattributed_hours).toLocaleString()} hours but ${num(r.unattributed_count) === 1 ? 'has' : 'have'} no matching Jobber user, so no work can be credited to them. Those hours still count in the company figure above — which is why it is lower than the per-person ranking suggests. Adding them in Jobber would fix the attribution.`)
      }

      const departed = (r.people ?? []).filter(p => !p.is_active && num(p.hours) > 0)
      if (departed.length > 0) {
        items.push(`${departed.map(p => p.name).join(', ')} no longer ${departed.length === 1 ? 'works' : 'work'} here but ${departed.length === 1 ? 'is' : 'are'} included, because ${departed.length === 1 ? 'their' : 'their'} hours were really worked in this period.`)
      }

      return { kind: 'list', title: 'What the Numbers Say', sub: `Read of ${periodPhrase(r, win)}`, items }
    },
  },
]

/** The arrangement Report §8.6 ships with. */
export const CREW_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_revenue_per_labor_hour', span: 3 },
  { type: 'kpi_labor_hours', span: 3 },
  { type: 'kpi_labor_cost_pct', span: 3 },
  { type: 'kpi_revenue_per_visit', span: 3 },
  { type: 'crew_insights', span: 12 },
  { type: 'crew_rev_per_hour_ranking', span: 6 },
  { type: 'crew_hours_by_person', span: 6 },
  { type: 'crew_hours_by_department', span: 6 },
  { type: 'crew_labor_table', span: 12 },
]
