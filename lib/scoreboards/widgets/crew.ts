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
import {
  keepPerson, peopleField, personFilter, withPeople, withPeopleTitle, type PersonFilter,
} from './people-filter'

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
  // The Hub timeclock only starts 2026-06-01. Where the months before it are
  // covered by payroll, say so rather than implying one source measured it all —
  // they are the same definition of an hour, but not the same record.
  if (r.coverage.backfilled && r.coverage.backfill_until) {
    return `${span} (payroll through ${pretty(r.coverage.backfill_until)}, timeclock after)`
  }
  return clamped ? `${span} (where clock data exists)` : span
}

function rankable(r: CrewLaborRow | null): CrewPerson[] {
  return (r?.people ?? []).filter(p => p.rankable && p.rev_per_hour != null)
}

/**
 * The person filter, applied to a crew row list.
 *
 * ⚠⚠ Only the PER-PERSON widgets take this filter. The three ratio KPIs
 * (revenue per labor hour, labor cost %, revenue per visit) deliberately do not,
 * because their numerator is company revenue computed WITHOUT per-technician
 * fan-out: a visit worked by two people credits both, so summing a subset's revenue
 * over-counts. The per-technician revenue trend measured that overshoot at $16,331 —
 * 3.8% of the year — on Heroes' book. A filtered ratio would therefore be inflated
 * and would not reconcile with anything, which is worse than not offering it. Hours
 * ARE additive per person, so "Hours Clocked" does take the filter.
 */
const PEOPLE_FIELD = { people: peopleField('staff_people', 'people') }

function onlyPeople(people: CrewPerson[], f: PersonFilter): CrewPerson[] {
  return people.filter(p => keepPerson(f, p.name, p.name))
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
    type: 'kpi_person_rev_per_hour',
    group: 'Crew & Labor',
    title: 'Revenue per Hour — One Person',
    blurb: 'One technician’s own rate, as a single figure',
    defaultSpan: 3,
    /**
     * The tile version of a row in "Revenue per Hour by Technician".
     *
     * ⚠⚠ WHY THIS EXISTS AS A SEPARATE WIDGET rather than a person filter on
     * `kpi_revenue_per_labor_hour`. That card divides COMPANY revenue — computed at
     * visit level with no per-technician fan-out — by clocked hours. Filtering its
     * hours to one person would leave the company's revenue over one person's hours:
     * a ratio whose numerator and denominator describe different populations, reading
     * absurdly high. That is exactly why the three Crew ratio KPIs were left
     * company-wide when the person filter shipped (Aug 17).
     *
     * This card is honest because BOTH halves are that person's own: their attributed
     * revenue over their own clocked hours — the identical arithmetic the ranking
     * chart already does per row, so the two agree by construction.
     *
     * ⚠ Multiple people ticked are summed, not averaged: their revenue over their
     * combined hours, which is the crew's rate. Averaging individual rates would
     * weight a 20-hour week the same as a 400-hour one.
     */
    config: PEOPLE_FIELD,
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, cfg, win) => {
      const r = crew(bag, win)
      const f = personFilter(cfg)
      /* ⚠ An empty filter means EVERYONE on every other card, and here that would be
       * actively confusing rather than merely wide: the rankable crew's combined rate
       * is NOT the same number as "Revenue per Labor Hour", which divides company
       * revenue (no per-tech fan-out, and including work nobody is credited for) by
       * all clocked hours. Two near-identical tiles showing different figures is worse
       * than one tile asking to be configured. */
      if (!f.active) {
        return {
          kind: 'kpi',
          label: 'Revenue per Hour — One Person',
          value: '—',
          tone: 'neutral',
          sub: 'Pick who this card is about in its ⚙ settings. For the whole company, use “Revenue per Labor Hour” instead — it is a different calculation, not this one left unfiltered.',
        }
      }
      const picked = onlyPeople(rankable(r), f)
      const hours = picked.reduce((s, p) => s + num(p.hours), 0)
      const revenue = picked.reduce((s, p) => s + num(p.revenue), 0)
      const rate = hours > 0 ? revenue / hours : null
      // Anyone the filter matched who cannot be ranked — salaried, under an hour, or
      // with no Jobber user to credit work to. Named, because a rate quietly computed
      // without them is a different number than the one asked for.
      const skipped = onlyPeople((r?.people ?? []).filter(p => !p.rankable), f)
      const who = picked.length === 1
        ? picked[0].name
        : picked.length > 1
          ? `${picked.length} people`
          : null
      return {
        kind: 'kpi',
        label: who ? `Revenue per Hour — ${who}` : 'Revenue per Hour — One Person',
        value: rate != null ? `${formatCurrency(rate)}/hr` : '—',
        tone: rate == null ? 'neutral' : rate >= 100 ? 'good' : rate >= 50 ? 'warn' : 'bad',
        sub: rate != null
          ? [
              `${formatCurrency(revenue)} of work ÷ ${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} clocked hours`,
              periodPhrase(r, win),
              ...(picked.length > 1 ? [`combined across ${picked.map(p => p.name).join(', ')}`] : []),
              ...(skipped.length ? [`not counted: ${skipped.map(p => p.name).join(', ')}`] : []),
            ].join(' · ')
          : `Nobody ticked has both clocked hours and attributed work in this period${skipped.length ? ` — ${skipped.map(p => p.name).join(', ')} cannot be ranked` : ''}`,
      }
    },
  },

  {
    type: 'kpi_labor_hours',
    group: 'Crew & Labor',
    title: 'Hours Clocked',
    blurb: 'Total field hours actually worked',
    defaultSpan: 3,
    config: PEOPLE_FIELD,
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, cfg, win) => {
      const r = crew(bag, win)
      const f = personFilter(cfg)
      const people = onlyPeople(r?.people ?? [], f)
      const n = people.length
      // Hours are additive per person, so a filtered total is exact — unlike the
      // ratio KPIs, which is why this one carries the filter and they don't.
      const hours = f.active ? people.reduce((s, p) => s + num(p.hours), 0) : num(r?.hours)
      return {
        kind: 'kpi',
        label: withPeopleTitle('Hours Clocked', f),
        value: r && r.coverage.has_data ? hours.toLocaleString() : '—',
        sub: r && r.coverage.has_data
          ? withPeople(`${n} ${n === 1 ? 'person' : 'people'} on the clock · ${periodPhrase(r, win)}`, f)
          : 'No timeclock data for this period',
      }
    },
  },

  {
    type: 'kpi_labor_cost_pct',
    group: 'Crew & Labor',
    title: 'Labor Cost % of Revenue',
    blurb: 'Share of the work that went to field pay — hourly, overtime and commission',
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
        /* ⚠⚠ SAY WHAT IS IN THE NUMBER, NOT JUST WHO IS OUT. This card used to read
         * "in hourly field wages · salaried staff not included", which named the one
         * omission that did NOT matter and hid the four that did. Ben checked Mike
         * Cyplik against Gusto in Aug 2026 and found $27,056 where payroll said
         * $34,908.80 — the gap was commission, holiday, PTO and bonus, none of it
         * mentioned anywhere on the card. Commission is now IN (it is pay for
         * producing this very revenue); holiday, vacation/sick, bonus and tips are
         * out. Both halves are stated, because a caveat that points at the wrong
         * omission is worse than no caveat at all. */
        sub: r
          ? `${formatCurrency(num(r.labor_cost))} in field pay — hourly, overtime and commission`
            + `${num(r.commission) > 0 ? ` (${formatCurrency(num(r.commission))} of it commission)` : ''}`
            + ` · excludes holiday, PTO, bonus and salaried staff`
          : 'No payroll or timeclock data for this period',
      }
    },
  },

  {
    type: 'kpi_person_labor_cost_pct',
    group: 'Crew & Labor',
    title: 'Labor Cost % — One Person',
    blurb: 'What share of one technician’s own production went to their pay',
    defaultSpan: 3,
    /**
     * Ben asked to "dial down" Labor Cost % of Revenue to technicians.
     *
     * ⚠⚠ A SEPARATE WIDGET, not a person filter on `kpi_labor_cost_pct` — the same
     * decision, for the same reason, as `kpi_person_rev_per_hour` above. That card
     * divides hourly field wages by COMPANY revenue, computed at visit level with no
     * per-technician fan-out. Filtering only its wage half would leave one person's
     * wages over the whole company's revenue and report something near 2%, which
     * looks like a wonderful number and means nothing at all.
     *
     * This card is honest because BOTH halves belong to the people ticked: their
     * wages over the revenue attributed to them — the same two figures the Crew table
     * already shows side by side, so it agrees with that table by construction.
     *
     * ⚠ Several people ticked are WEIGHTED, not averaged: their combined wages over
     * their combined revenue. Averaging each person's percentage would let a
     * 20-hour week count as much as a 400-hour one.
     */
    config: PEOPLE_FIELD,
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, cfg, win) => {
      const r = crew(bag, win)
      const f = personFilter(cfg)
      /* ⚠ An empty filter asks rather than defaulting to everyone. The crew's combined
       * figure is NOT the same number as "Labor Cost % of Revenue", which divides by
       * company revenue including work nobody is credited for — so an unfiltered
       * version of this card would sit beside that one showing a different percentage
       * for what reads like the same question. */
      if (!f.active) {
        return {
          kind: 'kpi',
          label: 'Labor Cost % — One Person',
          value: '—',
          tone: 'neutral',
          sub: 'Pick who this card is about in its ⚙ settings. For the whole company, use “Labor Cost % of Revenue” instead — it is a different calculation, not this one left unfiltered.',
        }
      }
      // Same rankable test the per-person $/hour card uses, so the two cards never
      // disagree about who can be measured.
      const picked = onlyPeople(rankable(r), f)
      const cost = picked.reduce((s, p) => s + num(p.labor_cost), 0)
      const revenue = picked.reduce((s, p) => s + num(p.revenue), 0)
      const pct = revenue > 0 ? Math.round((cost / revenue) * 1000) / 10 : null
      /* Anyone ticked who cannot be measured. ⚠ This is not tidiness: someone with
       * real clocked wages but no Jobber user has cost and NO revenue, so quietly
       * including them would divide by a denominator missing their share of the work
       * and report a percentage that is too high. Excluded, and named. */
      const skipped = onlyPeople((r?.people ?? []).filter(p => !p.rankable || p.rev_per_hour == null), f)
      const who = picked.length === 1
        ? picked[0].name
        : picked.length > 1
          ? `${picked.length} people`
          : null
      return {
        kind: 'kpi',
        label: who ? `Labor Cost % — ${who}` : 'Labor Cost % — One Person',
        value: pct != null ? `${pct}%` : '—',
        // Same bands as the company card, so the two read on one scale.
        tone: pct == null ? 'neutral' : pct <= 30 ? 'good' : pct <= 40 ? 'warn' : 'bad',
        sub: pct != null
          ? [
              `${formatCurrency(cost)} in their pay — hourly, overtime and commission — ÷ ${formatCurrency(revenue)} of work credited to them`,
              periodPhrase(r, win),
              ...(picked.length > 1 ? [`combined across ${picked.map(p => p.name).join(', ')}`] : []),
              /* ⚠ STATES WHICH WAY THE ERROR RUNS, and the answer changed on
               * 2026-08-20. A shared visit still credits its full value to BOTH techs,
               * so it inflates the denominator and flatters the technician — the
               * direction nobody questions. But multi-day INSTALLS no longer work that
               * way: `install_labor_credits` carries a per-crew-day fractional share
               * that sums to the job total, so for those jobs there is no double count
               * in either direction. Saying "shared visits make this read low" with no
               * qualifier would now be false for exactly the jobs that dominate an
               * irrigation tech's number, which is worse than saying nothing. */
              ...(num(r?.coverage?.install_credits_applied ?? 0) > 0
                ? ['multi-day installs are credited by crew-day share, so they are counted once across the crew']
                : []),
              'a shared service visit is credited to both techs, so it makes this read slightly low',
              ...(skipped.length ? [`not counted: ${skipped.map(p => p.name).join(', ')}`] : []),
            ].join(' · ')
          : `Nobody ticked has both pay and attributed work in this period${skipped.length ? ` — ${skipped.map(p => p.name).join(', ')} cannot be measured` : ''}`,
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
    config: PEOPLE_FIELD,
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, cfg, win) => {
      const r = crew(bag, win)
      const f = personFilter(cfg)
      const rows = onlyPeople(rankable(r), f)
        .slice()
        .sort((a, b) => num(b.rev_per_hour) - num(a.rev_per_hour))
        .map(p => ({
          label: p.name,
          value: num(p.rev_per_hour),
          tone: (num(p.rev_per_hour) >= 100 ? 'good' : num(p.rev_per_hour) >= 50 ? 'warn' : 'bad') as Tone,
          detail: `${formatCurrency(num(p.revenue))} over ${num(p.hours).toLocaleString()} hrs${p.is_active ? '' : ' · no longer employed'}`,
        }))
      const skipped = onlyPeople((r?.people ?? []).filter(p => !p.rankable), f)
      return {
        kind: 'bars',
        title: withPeopleTitle('Revenue per Hour by Technician', f),
        sub: withPeople(periodPhrase(r, win), f),
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
    config: PEOPLE_FIELD,
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, cfg, win) => {
      const r = crew(bag, win)
      const f = personFilter(cfg)
      const rows = onlyPeople(r?.people ?? [], f)
        .filter(p => num(p.hours) > 0)
        .map(p => ({
          label: p.name,
          value: num(p.hours),
          tone: (p.is_active ? 'neutral' : 'unknown') as Tone,
          detail: num(p.labor_cost) > 0
            ? `${formatCurrency(num(p.labor_cost))} in pay${p.is_active ? '' : ' · no longer employed'}`
            : 'No payroll matched to these hours yet',
        }))
      return {
        kind: 'bars',
        title: withPeopleTitle('Hours by Person', f),
        sub: withPeople(`${periodPhrase(r, win)} · includes people who have since left`, f),
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
    blurb: 'Hours, pay and work per person',
    defaultSpan: 12,
    config: PEOPLE_FIELD,
    sources: (_cfg, win) => [crewReq(win)],
    metric: (bag, cfg, win) => {
      const r = crew(bag, win)
      const f = personFilter(cfg)
      const rows = onlyPeople(r?.people ?? [], f).map(p => ({
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
        title: withPeopleTitle('Crew Detail', f),
        sub: withPeople(periodPhrase(r, win), f),
        columns: [
          { key: 'name', label: 'Person', align: 'left' },
          { key: 'department', label: 'Department', align: 'left' },
          { key: 'hours', label: 'Hours', align: 'right', format: 'number', sortable: true },
          /* "Wages" read as gross pay to the one person who checked it against
           * Gusto. Named for what it holds. */
          { key: 'cost', label: 'Pay (hrly+OT+comm)', align: 'right', format: 'currency' },
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
        items.push(`These figures cover ${pretty(r.coverage.effective_start)} – ${pretty(r.coverage.effective_end)}, not the full range you picked. Dividing a longer stretch of revenue by a shorter stretch of hours would overstate revenue per hour — badly.`)
      }
      /* Why the window stops short of today even on a to-date range: pay comes from
       * processed payroll now, and estimating the last few days from hours x rate
       * cannot see a commission at all, so it would drag the ratio down. */
      if (num(r.coverage.unpaid_tail_days) > 0) {
        items.push(`Pay is counted through ${pretty(r.coverage.payroll_through)}, the last payroll run. There ${num(r.coverage.unpaid_tail_days) === 1 ? 'is 1 more day' : `are ${num(r.coverage.unpaid_tail_days)} more days`} of clocked hours after that with no payroll yet, so ${num(r.coverage.unpaid_tail_days) === 1 ? 'it is' : 'they are'} left out rather than estimated.`)
      }

      items.push(`${formatCurrency(num(r.revenue))} of completed work against ${num(r.hours).toLocaleString()} clocked hours — ${r.rev_per_hour != null ? formatCurrency(num(r.rev_per_hour)) : '—'} per labor hour, across ${num(r.visits).toLocaleString()} visits.`)

      if (r.labor_pct != null) {
        items.push(`Field pay — hourly, overtime and commission — was ${formatCurrency(num(r.labor_cost))}, or ${num(r.labor_pct)}% of the work completed. Holiday, PTO, bonuses and salaried staff aren't in that figure, so true payroll load is higher.`)
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
