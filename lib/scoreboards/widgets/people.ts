/* People Performance widgets — the library behind Report §8.7.
 *
 * This is the one report a person opens to see THEIR OWN numbers, so it is
 * built to two rules that are not negotiable:
 *
 *   1. ⚠ NO PAY. Hours, revenue, $/hour, sales and phone activity. Never a wage
 *      rate, never a labour cost. Crew & Labor and Service Lines carry those and
 *      stay restricted; this report is meant to be seen by its subject.
 *
 *   2. ⚠ NO COACHING GRADES. Ben's call, 2026-08-12: nobody sees their own
 *      grade. Call Coaching is its own report behind its own flag, and nothing
 *      from it is surfaced here.
 *
 * ⚠⚠ THE COMPARISON GUARD. Ranking people by $/labour-hour across service lines
 * is not a fairness comparison — Pet Waste pays $23/labour-hour and Fert Tech
 * pays $149, which is a fact about the LINE, not the person. A raw company
 * ranking would read as "Bonnie is six times worse than Mike". So every personal
 * $/hour is shown against that person's own DEPARTMENT, and the department table
 * carries the company picture separately.
 *
 * ⚠ Office staff have no field section and that is correct, not missing: a
 * $/labour-hour for the office manager would divide sales work by zero clocked
 * field hours. Their card is sales and phone, and it says so.
 */

import { formatCurrency, formatDurationSec } from '@/lib/format'
import type { Person, PeopleRow } from './sources'
import type { SourceBag, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

const peopleReq = (win: WindowSpec) => ({
  source: 'people' as const,
  params: { start: win.start, end: win.end },
})

function data(bag: SourceBag, win: WindowSpec): PeopleRow | null {
  return bag.get<PeopleRow>(peopleReq(win))[0] ?? null
}

/** The row belonging to whoever is looking. Present in both scopes. */
function me(r: PeopleRow | null): Person | null {
  return r?.people.find(p => p.is_viewer) ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pretty(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

/**
 * The period actually measured for FIELD figures.
 *
 * Hours come from the timeclock, which starts long after invoices do, so the
 * source clamps. Saying the requested range when the source measured less is
 * the failure this product claims to beat.
 */
function fieldPeriod(r: PeopleRow | null, win: WindowSpec): string {
  const c = r?.coverage
  if (!c?.has_data) return win.phrase
  if (!c.clamped) return win.phrase
  return `${pretty(c.effective_start)} – ${pretty(c.effective_end)} (where clock data exists)`
}

/** The viewer's own department row, for the only fair $/hour comparison. */
function myDepartment(r: PeopleRow | null): PeopleRow['departments'][number] | null {
  const mine = me(r)
  if (!mine?.department) return null
  return r?.departments.find(d => d.department === mine.department) ?? null
}

function rateTone(pct: number | null | undefined): Tone {
  if (pct == null) return 'neutral'
  if (pct >= 60) return 'good'
  if (pct >= 35) return 'warn'
  return 'bad'
}

export const PEOPLE_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'my_sales',
    group: 'People',
    title: 'What you sold',
    blurb: 'Your leads, wins and value sold',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const p = me(r)
      const min = r?.rate_min_sample ?? 10
      if (!p) {
        return {
          kind: 'kpi',
          label: 'What you sold',
          value: '—',
          sub: 'No record for you in this period',
        }
      }
      const rate = p.sales.close_rate
      return {
        kind: 'kpi',
        label: 'What you sold',
        value: formatCurrency(num(p.sales.sold_value)),
        tone: num(p.sales.sold_value) > 0 ? 'good' : 'neutral',
        /* The denominator is named because "close rate" alone invites the
         * reading that it is a share of all leads. It is decided leads.
         *
         * ⚠ `won` and `decided` are NOT phrased as numerator-over-denominator any
         * more. `won` counts everything sold, including the stages marked "counts as
         * a sale" (Heroes: Upsells), while the close rate is competed-only — so
         * "12 won of 9 decided (78%)" was reachable on a rep with upsells. The two
         * facts are now stated side by side instead of as one ratio. */
        sub: rate != null
          ? `${win.phrase} · ${num(p.sales.won)} sold · ${rate}% of ${num(p.sales.decided)} decided leads closed`
          : num(p.sales.decided) > 0
            ? `${win.phrase} · ${num(p.sales.won)} sold · too few decided to rate fairly (under ${min})`
            : `${win.phrase} · no leads assigned to you`,
      }
    },
  },

  {
    type: 'my_avg_deal',
    group: 'People',
    title: 'Your average deal',
    blurb: 'Value per sale you closed',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const p = me(data(bag, win))
      return {
        kind: 'kpi',
        label: 'Your average deal',
        value: p?.sales.avg_deal != null ? formatCurrency(num(p.sales.avg_deal)) : '—',
        sub: p && num(p.sales.won) > 0
          ? `${win.phrase} · across ${num(p.sales.won)} sale${num(p.sales.won) === 1 ? '' : 's'}`
          : 'Nothing closed in this period',
      }
    },
  },

  {
    type: 'my_production',
    group: 'People',
    title: 'Work you produced',
    blurb: 'Revenue credited to your visits',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const p = me(r)
      if (!p || !p.is_field_labor) {
        return {
          kind: 'kpi',
          label: 'Work you produced',
          value: '—',
          // Absence with a reason. An office role has no field production and
          // should not read as a zero that looks like underperformance.
          sub: p ? 'Not a field role — your card is sales and phone' : 'No record for you',
        }
      }
      return {
        kind: 'kpi',
        label: 'Work you produced',
        value: p.field.revenue != null ? formatCurrency(num(p.field.revenue)) : '—',
        tone: 'neutral',
        sub: p.field.attributable
          ? `${fieldPeriod(r, win)} · ${num(p.field.hours).toLocaleString()} hours clocked`
          : `${num(p.field.hours).toLocaleString()} hours clocked · no Jobber user matches you, so work can't be credited`,
      }
    },
  },

  {
    type: 'my_rev_per_hour',
    group: 'People',
    title: 'Your $ per hour',
    blurb: 'Revenue per hour you clocked, against your department',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const p = me(r)
      const dept = myDepartment(r)
      if (!p || !p.is_field_labor) {
        return {
          kind: 'kpi',
          label: 'Your $ per hour',
          value: '—',
          sub: p ? 'Not a field role — no clocked hours to divide by' : 'No record for you',
        }
      }
      if (!p.field.rankable || p.field.rev_per_hour == null) {
        return {
          kind: 'kpi',
          label: 'Your $ per hour',
          value: '—',
          sub: 'Too few clocked hours in this period to be meaningful',
        }
      }
      const mine = num(p.field.rev_per_hour)
      const avg = dept?.rev_per_hour != null ? num(dept.rev_per_hour) : null
      // ⚠ Compared to the DEPARTMENT, never the company. See the header.
      const sub = avg != null
        ? `${dept!.department} averages ${formatCurrency(avg)}/hr`
        : `${fieldPeriod(r, win)}`
      return {
        kind: 'kpi',
        label: 'Your $ per hour',
        value: `${formatCurrency(mine)}/hr`,
        tone: avg == null ? 'neutral' : mine >= avg ? 'good' : 'warn',
        judged: true,
        sub,
      }
    },
  },

  {
    type: 'my_phone',
    group: 'People',
    title: 'Your phone & texts',
    blurb: 'Calls you answered and placed, texts you sent',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const p = me(r)
      if (!p) {
        return { kind: 'list', title: 'Your phone & texts', sub: win.phrase, items: [], empty: 'No record for you' }
      }
      const items = [
        `${num(p.phone.calls_answered).toLocaleString()} inbound calls answered`,
        `${num(p.phone.calls_placed).toLocaleString()} calls placed`,
        `${num(p.phone.texts_sent).toLocaleString()} texts sent`,
      ]
      if (p.phone.median_answer_sec != null) {
        items.push(`Typically picked up in ${formatDurationSec(num(p.phone.median_answer_sec))}`)
      }
      return {
        kind: 'list',
        title: 'Your phone & texts',
        sub: win.phrase,
        items,
      }
    },
  },

  {
    type: 'people_department',
    group: 'People',
    title: 'How your department is doing',
    blurb: 'Revenue, hours and $/hour per department',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const mine = me(r)?.department ?? null
      const rows = (r?.departments ?? []).map(d => ({
        key: d.department,
        cells: {
          department: d.department + (d.department === mine ? '  ← yours' : ''),
          people: num(d.people),
          hours: Math.round(num(d.hours)),
          revenue: num(d.revenue),
          rate: d.rev_per_hour != null ? num(d.rev_per_hour) : null,
        },
        tones: d.department === mine ? ({ department: 'good' } as Record<string, Tone>) : undefined,
      }))
      return {
        kind: 'table',
        title: 'How your department is doing',
        sub: fieldPeriod(r, win),
        columns: [
          { key: 'department', label: 'Department', align: 'left' },
          { key: 'people', label: 'People', align: 'right', format: 'number' },
          { key: 'hours', label: 'Hours', align: 'right', format: 'number' },
          { key: 'revenue', label: 'Revenue', align: 'right', format: 'currency', sortable: true },
          { key: 'rate', label: '$ / hour', align: 'right', format: 'currency', sortable: true },
        ],
        rows,
        empty: 'No department has clocked hours in this period',
        // Stated because the numbers invite exactly the wrong comparison.
        foot: 'Departments do different work at different price points, so $/hour is only comparable within a department.',
      }
    },
  },

  {
    type: 'people_table',
    group: 'People',
    title: 'The team',
    blurb: 'One row per person: sales, production and phone',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const self = r?.scope === 'self'
      const rows = (r?.people ?? []).map(p => ({
        key: p.employee_id,
        cells: {
          name: p.name,
          department: p.department ?? 'Office',
          leads: num(p.sales.leads),
          won: num(p.sales.won),
          close_rate: p.sales.close_rate != null ? num(p.sales.close_rate) : null,
          sold: num(p.sales.sold_value),
          hours: Math.round(num(p.field.hours)),
          revenue: p.field.revenue != null ? num(p.field.revenue) : null,
          rate: p.field.rankable && p.field.rev_per_hour != null ? num(p.field.rev_per_hour) : null,
          answered: num(p.phone.calls_answered),
          texts: num(p.phone.texts_sent),
        },
        tones: {
          close_rate: rateTone(p.sales.close_rate),
        } as Record<string, Tone>,
        meta: !p.is_active
          ? { text: 'No longer with the company — their hours stay in the record', tone: 'neutral' as Tone }
          : undefined,
      }))
      return {
        kind: 'table',
        title: self ? 'Your row' : 'The team',
        sub: self ? win.phrase : `${rows.length} people · ${win.phrase}`,
        columns: [
          { key: 'name', label: 'Person', align: 'left' },
          { key: 'department', label: 'Department', align: 'left' },
          { key: 'leads', label: 'Leads', align: 'right', format: 'number', sortable: true },
          // "Sold", not "Won": includes any stage marked as counting as a sale, so it
          // is deliberately not the close rate's numerator.
          { key: 'won', label: 'Sold', align: 'right', format: 'number', sortable: true, title: 'Deals sold, including upsells if your Lead Tracker counts them as sales' },
          { key: 'close_rate', label: 'Close rate', align: 'right', format: 'percent', sortable: true },
          { key: 'sold', label: 'Sold', align: 'right', format: 'currency', sortable: true },
          { key: 'hours', label: 'Hours', align: 'right', format: 'number', sortable: true },
          { key: 'revenue', label: 'Produced', align: 'right', format: 'currency', sortable: true },
          { key: 'rate', label: '$ / hour', align: 'right', format: 'currency', sortable: true },
          { key: 'answered', label: 'Calls', align: 'right', format: 'number', sortable: true },
          { key: 'texts', label: 'Texts', align: 'right', format: 'number', sortable: true },
        ],
        rows,
        empty: 'Nobody has activity in this period',
        // In self scope this explains the single row rather than letting it look
        // like the report is broken or the team has one person in it.
        foot: self
          ? 'You are seeing your own row. Team-wide performance needs the People Performance grant from an admin.'
          : 'A blank close rate means too few decided leads to rate fairly. A blank $/hour means salaried, under an hour clocked, or no Jobber match.',
      }
    },
  },

  {
    type: 'people_office_phone',
    group: 'People',
    title: 'How the phones did',
    blurb: 'Office-wide answer rate and response times',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const o = r?.office
      if (!o) {
        return { kind: 'list', title: 'How the phones did', sub: win.phrase, items: [], empty: 'No call data' }
      }
      const items = [
        `${num(o.inbound_calls).toLocaleString()} inbound calls`,
        o.missed_pct != null
          ? `${num(o.missed).toLocaleString()} missed (${num(o.missed_pct)}%)`
          : `${num(o.missed).toLocaleString()} missed`,
        o.median_answer_sec != null
          ? `Typically answered in ${formatDurationSec(num(o.median_answer_sec))}`
          : 'No answer times recorded',
        `${num(o.texts_in).toLocaleString()} texts in · ${num(o.texts_out).toLocaleString()} out`,
      ]
      if (o.median_reply_sec != null) {
        items.push(`Texts typically replied to in ${formatDurationSec(num(o.median_reply_sec))}`)
      }
      return {
        kind: 'list',
        title: 'How the phones did',
        sub: `${win.phrase} · the whole office`,
        items,
      }
    },
  },

  {
    type: 'people_notes',
    group: 'People',
    title: 'What these numbers do and do not say',
    blurb: 'The limits of this report, stated on its face',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [peopleReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const items: string[] = [
        'No pay is shown anywhere on this report.',
        // The single most important caveat, because the obvious metric is the
        // one that cannot be trusted.
        'There is no personal "answer rate". A call is stamped to whoever the line points at before it is even offered, so answered-versus-routed would say more about the routing than the person.',
      ]
      if (r?.coverage?.clamped) {
        items.push(
          `Hours and $/hour cover ${pretty(r.coverage.effective_start)} – ${pretty(r.coverage.effective_end)}, where timeclock data exists. Sales and phone cover the full period.`,
        )
      }
      const unmatched = r?.unmatched_sales ?? []
      if (unmatched.length) {
        const names = unmatched.map(u => `${u.name} (${num(u.leads)} leads)`).join(', ')
        items.push(
          `Sales filed under a name that matches nobody on the roster are left off every person: ${names}.`,
        )
      }
      items.push(
        'Where two people worked one visit, both are credited with it, so personal revenue does not sum to the company total.',
      )
      return {
        kind: 'list',
        title: 'What these numbers do and do not say',
        sub: win.phrase,
        items,
      }
    },
  },
]

export const PEOPLE_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'my_sales', span: 3 },
  { type: 'my_avg_deal', span: 3 },
  { type: 'my_production', span: 3 },
  { type: 'my_rev_per_hour', span: 3 },
  { type: 'my_phone', span: 6 },
  { type: 'people_department', span: 6 },
  { type: 'people_table', span: 12 },
  { type: 'people_office_phone', span: 6 },
  { type: 'people_notes', span: 6 },
]
