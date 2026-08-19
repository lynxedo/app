/* Service Line Profitability widgets — Report §8.8, rescoped.
 *
 * §8.8 asks for per-JOB margin. That isn't honestly buildable: the timeclock
 * records who and when but never WHICH JOB, and visits are scheduled as all-day
 * "Anytime" windows (averaging 958 minutes) so they can't stand in for time on
 * site. Ben's call was to do service lines instead, which the data does support.
 *
 * ⚠ Labor is allocated by what people ACTUALLY DID, not by their department field:
 * one tech sits in department "01 - Fert Tech" with the job title "Lead Technician
 * - IR", so the label would file irrigation labor under weed-and-feed. Each
 * tech-day's hours are split across the lines they completed visits in that day.
 *
 * ⚠ NOTHING IS DROPPED. 65 of 204 clocked days have no completed visits at all —
 * 482.5 hours, 28.3% of the wage bill (shop, drive, rain). Spreading only the other
 * 72% across the lines would make every one look about a quarter more profitable
 * than it is, which is the direction of error that makes you underprice. Those
 * hours get their own bucket and the page shows it.
 *
 * ⚠ This is REVENUE AFTER LABOUR, never called margin. Only 4 of 87 line items
 * have an active product mapping, and the mapped ones cluster in weed-and-feed —
 * charging materials to the one line that has them recorded would make it look
 * worse than lines whose materials simply aren't mapped yet. That's an artefact,
 * not a fact, so materials stay out until Service Mapping is complete.
 */

import { formatCurrency } from '@/lib/format'
import type { ServiceLinesRow, ServiceLine } from './sources'
import type { SourceBag, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

const svcReq = (win: WindowSpec) => ({
  source: 'service_lines' as const,
  params: { start: win.start, end: win.end },
})

function svc(bag: SourceBag, win: WindowSpec): ServiceLinesRow | null {
  return bag.get<ServiceLinesRow>(svcReq(win))[0] ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Heroes' internal codes, spelled out. Unknown codes pass through unchanged. */
const LINE_NAMES: Record<string, string> = {
  WF: 'Weed Fert',
  IR: 'Irrigation',
  PW: 'Pet Waste',
  MO: 'Mosquito',
  LD: 'Landscaping',
  Other: 'Other / Unclassified',
}

/**
 * Exported so the visit-revenue trend charts label departments the same way this
 * report does. A chart reading "MO" beside a report reading "Mosquito" is the same
 * data wearing two names.
 *
 * ⚠ A near-duplicate still lives in ./quotes.ts as SERVICE_LABEL, with slightly
 * different wording ("Weed & Feed" vs "Weed Fert"). Worth folding into one map;
 * not done here because it would change strings on a shipped report.
 */
export function lineName(dept: string): string {
  return LINE_NAMES[dept] ?? dept
}

function pretty(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** The period actually measured — the window is clamped to timeclock coverage. */
function periodPhrase(r: ServiceLinesRow | null, win: WindowSpec): string {
  if (!r || !r.coverage.has_data) return win.phrase
  const span = `${pretty(r.coverage.effective_start)} – ${pretty(r.coverage.effective_end)}`
  return r.coverage.clamped ? `${span} (where clock data exists)` : span
}

/** Lines with enough hours behind them to compare. Guards the same way §8.6 does. */
function comparable(r: ServiceLinesRow | null): ServiceLine[] {
  return (r?.lines ?? []).filter(l => num(l.hours) >= 1 && num(l.revenue) > 0)
}

function pctTone(pct: number): Tone {
  return pct >= 60 ? 'good' : pct >= 40 ? 'warn' : 'bad'
}

export const SERVICE_LINE_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_revenue_after_labor',
    group: 'Service Lines',
    title: 'Revenue After Labor',
    blurb: 'What is left once the crew is paid',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [svcReq(win)],
    metric: (bag, _cfg, win) => {
      const r = svc(bag, win)
      const rev = num(r?.revenue_total)
      const left = rev - num(r?.labor_total)
      const pct = rev > 0 ? Math.round((100 * left) / rev * 10) / 10 : null
      return {
        kind: 'kpi',
        label: 'Revenue After Labor',
        value: r ? formatCurrency(left) : '—',
        tone: pct == null ? 'neutral' : pctTone(pct),
        judged: true,
        sub: r && pct != null
          ? `${pct}% of ${formatCurrency(rev)} · before materials, fuel and overhead`
          : 'No work in this period',
      }
    },
  },

  {
    type: 'kpi_strongest_line',
    group: 'Service Lines',
    title: 'Strongest Line',
    blurb: 'Best revenue per labor hour',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [svcReq(win)],
    metric: (bag, _cfg, win) => {
      const best = comparable(svc(bag, win)).sort((a, b) => num(b.rev_per_hour) - num(a.rev_per_hour))[0]
      return {
        kind: 'kpi',
        label: 'Strongest Line',
        value: best ? lineName(best.dept) : '—',
        tone: 'good',
        sub: best
          ? `${formatCurrency(num(best.rev_per_hour))} per labor hour · ${num(best.after_labor_pct)}% left after wages`
          : 'Not enough data to compare',
      }
    },
  },

  {
    type: 'kpi_weakest_line',
    group: 'Service Lines',
    title: 'Weakest Line',
    blurb: 'Lowest revenue per labor hour',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [svcReq(win)],
    metric: (bag, _cfg, win) => {
      const worst = comparable(svc(bag, win)).sort((a, b) => num(a.rev_per_hour) - num(b.rev_per_hour))[0]
      return {
        kind: 'kpi',
        label: 'Weakest Line',
        value: worst ? lineName(worst.dept) : '—',
        tone: worst ? pctTone(num(worst.after_labor_pct)) : 'neutral',
        judged: true,
        sub: worst
          ? `${formatCurrency(num(worst.rev_per_hour))} per labor hour · ${num(worst.after_labor_pct)}% left after wages`
          : 'Not enough data to compare',
      }
    },
  },

  {
    /* The honesty tile. Without it the per-line figures look better than payroll. */
    type: 'kpi_unassigned_time',
    group: 'Service Lines',
    title: 'Unassigned Field Time',
    blurb: 'Paid hours not tied to any visit',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [svcReq(win)],
    metric: (bag, _cfg, win) => {
      const r = svc(bag, win)
      const hrs = num(r?.unassigned_hours)
      const total = num(r?.hours_total)
      const pct = total > 0 ? Math.round((100 * hrs) / total) : 0
      return {
        kind: 'kpi',
        label: 'Unassigned Field Time',
        value: r ? `${hrs.toLocaleString()} hrs` : '—',
        tone: pct >= 25 ? 'warn' : 'neutral',
        judged: true,
        sub: r
          ? `${formatCurrency(num(r.unassigned_cost))} · ${pct}% of paid hours on days with no completed visit`
          : 'No hours in this period',
      }
    },
  },

  {
    type: 'service_line_table',
    group: 'Service Lines',
    title: 'Service Line Profitability',
    blurb: 'Revenue, labor and what is left, per line',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [svcReq(win)],
    metric: (bag, _cfg, win) => {
      const r = svc(bag, win)
      const rows = (r?.lines ?? []).map(l => ({
        key: l.dept,
        cells: {
          line: lineName(l.dept),
          revenue: num(l.revenue),
          visits: num(l.visits),
          hours: num(l.hours),
          labor: num(l.labor_cost),
          left: num(l.after_labor),
          pct: l.after_labor_pct != null ? num(l.after_labor_pct) : null,
          perhour: l.rev_per_hour != null ? num(l.rev_per_hour) : null,
        },
        tones: l.after_labor_pct != null
          ? { pct: pctTone(num(l.after_labor_pct)), perhour: pctTone(num(l.after_labor_pct)) }
          : undefined,
        // Where a line's revenue comes from changes how you read it — irrigation is
        // repair work, weed-and-feed is a subscription.
        meta: num(l.revenue_oneoff) > num(l.revenue_recurring)
          ? { text: 'Mostly one-off work — has to be won again each time', tone: 'warn' as Tone }
          : num(l.revenue_recurring) > 0
            ? { text: 'Mostly recurring — repeats without re-selling', tone: 'good' as Tone }
            : undefined,
      }))
      const unclassified = (r?.lines ?? []).find(l => l.dept === 'Other')
      return {
        kind: 'table',
        title: 'Service Line Profitability',
        sub: periodPhrase(r, win),
        drill: unclassified && num(unclassified.visits) > 0
          ? {
              href: `/hub/reports/service-lines/unclassified-work?start=${win.start}&end=${win.end}`,
              label: `See the ${num(unclassified.visits)} visit${num(unclassified.visits) === 1 ? '' : 's'} with no service line`,
            }
          : undefined,
        columns: [
          { key: 'line', label: 'Service line', align: 'left' },
          { key: 'revenue', label: 'Revenue', align: 'right', format: 'currency', sortable: true },
          { key: 'visits', label: 'Visits', align: 'right', format: 'number' },
          { key: 'hours', label: 'Labor hrs', align: 'right', format: 'number' },
          { key: 'labor', label: 'Wages', align: 'right', format: 'currency' },
          { key: 'left', label: 'After labor', align: 'right', format: 'currency', sortable: true },
          { key: 'pct', label: '% left', align: 'right', format: 'percent' },
          { key: 'perhour', label: '$ / labor hr', align: 'right', format: 'currency', sortable: true },
        ],
        rows,
        /* Two disclosures that stop this being read as margin. */
        foot: r
          ? `Wages come from the Hub timeclock — hours each person actually clocked, priced at their hourly rate on the Employee Roster. Salaried staff and anyone who does not clock in are NOT included, so this is field labour, not payroll. Hours are charged to a line by the visits that person completed that day rather than by the department on their record, because those labels drift. This is revenue after WAGES only — materials, fuel, vehicles and overhead are not deducted, so it is not margin. A further ${num(r.unassigned_hours).toLocaleString()} paid hours (${formatCurrency(num(r.unassigned_cost))}) fell on days with no completed visit and belong to no line, so the per-line wages above add up to less than payroll.`
          : undefined,
        empty: 'No completed work in this period',
      }
    },
  },

  {
    type: 'rev_per_hour_by_line',
    group: 'Service Lines',
    title: 'Revenue per Labor Hour by Line',
    blurb: 'Which work pays best for the time it takes',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [svcReq(win)],
    metric: (bag, _cfg, win) => {
      const r = svc(bag, win)
      const rows = comparable(r)
        .sort((a, b) => num(b.rev_per_hour) - num(a.rev_per_hour))
        .map(l => ({
          label: lineName(l.dept),
          value: num(l.rev_per_hour),
          tone: pctTone(num(l.after_labor_pct)),
          detail: `${formatCurrency(num(l.revenue))} over ${num(l.hours).toLocaleString()} hrs`,
        }))
      return {
        kind: 'bars',
        title: 'Revenue per Labor Hour by Line',
        sub: periodPhrase(r, win),
        format: 'currency',
        rows,
        empty: 'Not enough data to compare lines',
      }
    },
  },

  {
    type: 'after_labor_by_line',
    group: 'Service Lines',
    title: 'What Is Left After Wages',
    blurb: 'Share of each line’s revenue that survives payroll',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [svcReq(win)],
    metric: (bag, _cfg, win) => {
      const r = svc(bag, win)
      const rows = comparable(r)
        .sort((a, b) => num(b.after_labor_pct) - num(a.after_labor_pct))
        .map(l => ({
          label: lineName(l.dept),
          value: num(l.after_labor_pct),
          tone: pctTone(num(l.after_labor_pct)),
          detail: `${formatCurrency(num(l.after_labor))} of ${formatCurrency(num(l.revenue))}`,
        }))
      return {
        kind: 'bars',
        title: 'What Is Left After Wages',
        sub: `${periodPhrase(r, win)} · before materials, fuel and overhead`,
        format: 'percent',
        rows,
        empty: 'Not enough data to compare lines',
      }
    },
  },

  {
    type: 'service_line_insights',
    group: 'Service Lines',
    title: 'What the Numbers Say',
    blurb: 'Plain-language read of line profitability',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [svcReq(win)],
    metric: (bag, _cfg, win) => {
      const r = svc(bag, win)
      const items: string[] = []
      const lines = comparable(r)

      if (!r || lines.length === 0) {
        return { kind: 'list', title: 'What the Numbers Say', sub: '', items: [], empty: 'Not enough completed work to compare service lines' }
      }

      if (r.coverage.clamped) {
        items.push(`These figures cover ${pretty(r.coverage.effective_start)} – ${pretty(r.coverage.effective_end)}, not the full range picked: the timeclock only has data from ${pretty(r.coverage.timeclock_first)}, and dividing a longer stretch of revenue by a shorter stretch of hours would overstate every line.`)
      }

      const sorted = [...lines].sort((a, b) => num(b.rev_per_hour) - num(a.rev_per_hour))
      const best = sorted[0], worst = sorted[sorted.length - 1]
      items.push(`${lineName(best.dept)} earns the most for the time it takes — ${formatCurrency(num(best.rev_per_hour))} per labor hour, keeping ${num(best.after_labor_pct)}% after wages. ${lineName(worst.dept)} is lowest at ${formatCurrency(num(worst.rev_per_hour))}, keeping ${num(worst.after_labor_pct)}%.`)

      const thin = lines.filter(l => num(l.after_labor_pct) < 40)
      for (const l of thin) {
        items.push(`⚠ ${lineName(l.dept)} brought in ${formatCurrency(num(l.revenue))} and spent ${formatCurrency(num(l.labor_cost))} of that on wages — only ${formatCurrency(num(l.after_labor))} left, and that is before any product, fuel or vehicle cost. At ${num(l.hours).toLocaleString()} hours across ${num(l.visits)} visits it is using real crew time; worth checking the price against how long the work actually takes.`)
      }

      const oneOffHeavy = lines.filter(l => num(l.revenue_oneoff) > num(l.revenue_recurring) && num(l.revenue) > 0)
      if (oneOffHeavy.length) {
        items.push(`${oneOffHeavy.map(l => lineName(l.dept)).join(' and ')} ${oneOffHeavy.length === 1 ? 'is' : 'are'} mostly one-off work rather than recurring, so that revenue has to be won again every time — steady on the surface, but it does not renew by itself.`)
      }

      items.push(`${num(r.unassigned_hours).toLocaleString()} paid hours (${formatCurrency(num(r.unassigned_cost))}, ${Math.round((100 * num(r.unassigned_hours)) / Math.max(1, num(r.hours_total)))}% of payroll) fell on days with no completed visit — shop time, driving, weather. Those are not charged to any line above, which is why the per-line wages add up to less than total payroll.`)

      // The metric's own limit, stated on the page rather than left to be discovered.
      items.push(`These figures deduct wages only. Materials are not included: product mapping currently covers a minority of line items, and charging materials to only the lines that happen to be mapped would make them look worse than the ones that aren't. Once Service Mapping is complete this becomes true margin.`)

      return { kind: 'list', title: 'What the Numbers Say', sub: `Read of ${periodPhrase(r, win)}`, items }
    },
  },
]

/** The arrangement Report §8.8 ships with. */
export const SERVICE_LINE_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_revenue_after_labor', span: 3 },
  { type: 'kpi_strongest_line', span: 3 },
  { type: 'kpi_weakest_line', span: 3 },
  { type: 'kpi_unassigned_time', span: 3 },
  { type: 'service_line_insights', span: 12 },
  { type: 'service_line_table', span: 12 },
  { type: 'rev_per_hour_by_line', span: 6 },
  { type: 'after_labor_by_line', span: 6 },
]
