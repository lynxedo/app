/* Communications widgets — the library behind Report §8.10.
 *
 * Pure Lynxedo: a Jobber-only competitor has no phone system and no texting, so
 * none of this exists for them at any price.
 *
 * ⚠ "Missed" keys off `answered_at`, never `status`. 955 inbound calls carry
 * status='completed' while only 605 have `answered_at` — completed means the call
 * ENDED, not that anyone picked up. Same trap as invoice_status on the Revenue
 * report: in this data a status is a label, the timestamp is the fact.
 *
 * ⚠ Amber counts as answered. She is the receptionist; a call she handled did not
 * go unanswered, and pretending otherwise would report the AI receptionist as a
 * service failure.
 *
 * ⚠ Missed is always shown BROKEN DOWN. Of Heroes' 385 unanswered calls, 132 left
 * a voicemail (you have the number and the message) and 56 hung up inside five
 * seconds (wrong number or abandoned — nobody could have answered). Publishing a
 * bare "37.8% missed" would treat those three groups as the same failure and
 * would be the kind of alarming-but-useless number this product exists to avoid.
 *
 * ⚠ Coaching grades are deliberately absent even though §8.10 lists them: Call
 * Coaching is gated to `can_access_coaching` (Ben only), and surfacing per-rep
 * grades behind `can_access_reports` would widen that audience by a side door.
 */

import { formatDurationSec } from '@/lib/format'
import type { CommsRow } from './sources'
import type { SourceBag, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

/**
 * Link from a figure to the rows behind it, carrying the CURRENT window so the
 * list is the same slice the number was read in. Point-in-time drill-downs
 * ignore the dates and say so on their own page.
 */
function drillTo(report: string, key: string, win: WindowSpec, label?: string) {
  return { href: `/hub/reports/${report}/${key}?start=${win.start}&end=${win.end}`, label }
}


const commsReq = (win: WindowSpec) => ({
  source: 'communications' as const,
  params: { start: win.start, end: win.end },
})

function comms(bag: SourceBag, win: WindowSpec): CommsRow | null {
  return bag.get<CommsRow>(commsReq(win))[0] ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Seconds → the shortest honest phrase. Under a minute stays in seconds. */
function dur(secs: number | string | null | undefined): string {
  if (secs == null) return '—'
  const s = Math.round(num(secs))
  if (s < 60) return `${s}s`
  return formatDurationSec(s, { style: 'verbose', seconds: true })
}

const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const COMMS_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_inbound_calls',
    group: 'Communications',
    title: 'Inbound Calls',
    blurb: 'Calls that came to you',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      return {
        kind: 'kpi',
        label: 'Inbound Calls',
        value: r ? num(r.inbound_calls).toLocaleString() : '—',
        sub: r
          ? `${win.phrase} · ${num(r.outbound_calls).toLocaleString()} outbound`
          : 'No calls in this period',
      }
    },
  },

  {
    /* ★ The number that costs money. */
    type: 'kpi_missed_rate',
    group: 'Communications',
    title: 'Missed Call Rate',
    blurb: 'Share of inbound calls nobody answered',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const p = r?.missed_pct
      return {
        kind: 'kpi',
        label: 'Missed Call Rate',
        value: p != null ? `${num(p)}%` : '—',
        tone: p == null ? 'neutral' : num(p) <= 10 ? 'good' : num(p) <= 25 ? 'warn' : 'bad',
        // The headline is honest only with the breakdown attached — a third of
        // these left a voicemail and are still reachable.
        sub: r
          ? `${num(r.missed).toLocaleString()} of ${num(r.inbound_calls).toLocaleString()} · ${num(r.missed_with_voicemail)} left a voicemail`
          : 'No calls in this period',
        drill: drillTo('communications', 'missed-calls', win, 'See the missed calls'),
      }
    },
  },

  {
    type: 'kpi_speed_to_answer',
    group: 'Communications',
    title: 'Speed to Answer',
    blurb: 'How fast a person picks up',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const m = r?.median_answer_sec
      return {
        kind: 'kpi',
        label: 'Speed to Answer',
        value: m != null ? dur(m) : '—',
        tone: m == null ? 'neutral' : num(m) <= 15 ? 'good' : num(m) <= 30 ? 'warn' : 'bad',
        sub: r && m != null
          ? `Typical (median) of ${num(r.answer_sample).toLocaleString()} answered · average ${dur(r.avg_answer_sec)}`
          : 'Nothing answered in this period',
      }
    },
  },

  {
    type: 'kpi_text_response',
    group: 'Communications',
    title: 'Text Response Time',
    blurb: 'How fast you reply to a customer text',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const m = r?.median_reply_sec
      return {
        kind: 'kpi',
        label: 'Text Response Time',
        value: m != null ? dur(m) : '—',
        tone: m == null ? 'neutral' : num(m) <= 900 ? 'good' : num(m) <= 3600 ? 'warn' : 'bad',
        /* Median AND the slow tail: the middle reply is minutes while the slowest
         * tenth is hours, and only the second number tells you someone is waiting
         * overnight. One figure alone would hide whichever story matters. */
        sub: r && m != null
          ? `Typical reply · slowest 10% take ${dur(r.p90_reply_sec)} · ${num(r.reply_sample).toLocaleString()} replies`
          : 'No replies in this period',
      }
    },
  },

  {
    type: 'kpi_text_volume',
    group: 'Communications',
    title: 'Texts',
    blurb: 'Messages in and out',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const failed = num(r?.texts_failed)
      return {
        kind: 'kpi',
        label: 'Texts Sent',
        value: r ? num(r.texts_out).toLocaleString() : '—',
        tone: failed > 0 ? 'warn' : 'neutral',
        judged: true,
        sub: r
          ? `${num(r.texts_in).toLocaleString()} received${failed > 0 ? ` · ⚠ ${failed} failed to deliver` : ''}`
          : 'No texts in this period',
      }
    },
  },

  {
    type: 'kpi_voicemails',
    group: 'Communications',
    title: 'Voicemails',
    blurb: 'Messages left, and any still unheard',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const unheard = num(r?.voicemails_unheard)
      return {
        kind: 'kpi',
        label: 'Voicemails',
        value: r ? num(r.voicemails).toLocaleString() : '—',
        tone: unheard > 0 ? 'bad' : 'good',
        judged: true,
        sub: unheard > 0
          ? `⚠ ${unheard} still unheard`
          : 'All heard',
      }
    },
  },

  {
    type: 'call_outcomes',
    group: 'Communications',
    title: 'What Happened to Inbound Calls',
    blurb: 'Answered, handled by the assistant, or missed',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const parts = r ? [
        { label: 'Answered by a person', value: num(r.answered_human), tone: 'good' as Tone },
        { label: 'Handled by the assistant', value: num(r.answered_ai), tone: 'mixed' as Tone },
        { label: 'Missed — left a voicemail', value: num(r.missed_with_voicemail), tone: 'warn' as Tone },
        { label: 'Missed — no message', value: num(r.missed_no_message), tone: 'bad' as Tone },
      ].filter(p => p.value > 0) : []
      return {
        kind: 'donut',
        title: 'What Happened to Inbound Calls',
        sub: `${win.phrase} · ${num(r?.inbound_calls).toLocaleString()} calls`,
        parts,
        note: r
          ? `Of the ${num(r.missed).toLocaleString()} nobody answered, ${num(r.missed_quick_hangup)} hung up within five seconds — too fast for anyone to reach the phone, so they are worth separating from real misses. The ${num(r.missed_with_voicemail)} who left a voicemail are still reachable; the ${num(r.missed_no_message)} who left nothing are the ones that quietly cost money.`
          : undefined,
        empty: 'No inbound calls in this period',
      }
    },
  },

  {
    type: 'calls_by_hour',
    group: 'Communications',
    title: 'Calls by Hour of Day',
    blurb: 'When the phone rings, and when you miss it',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const rows = (r?.by_hour ?? [])
        .filter(h => num(h.inbound) > 0)
        .map(h => {
          const total = num(h.inbound)
          const missed = num(h.missed)
          const hour = num(h.hour)
          const label = hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`
          return {
            label,
            caption: String(total),
            // Missed is a SUBSET of inbound, so stack missed + the remainder
            // rather than both totals, which would double-count every miss.
            parts: [
              { value: total - missed, tone: 'good' as Tone, label: 'Answered' },
              { value: missed, tone: 'bad' as Tone, label: 'Missed' },
            ],
          }
        })
      return {
        kind: 'stacked',
        title: 'Calls by Hour of Day',
        sub: `${win.phrase} · business time · bar length is call volume`,
        rows,
        legend: [{ label: 'Answered', tone: 'good' }, { label: 'Missed', tone: 'bad' }],
        empty: 'No inbound calls in this period',
      }
    },
  },

  {
    type: 'calls_by_weekday',
    group: 'Communications',
    title: 'Calls by Day of Week',
    blurb: 'Which days need more cover',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const rows = (r?.by_weekday ?? [])
        .slice()
        .sort((a, b) => WEEKDAY_ORDER.indexOf(a.label) - WEEKDAY_ORDER.indexOf(b.label))
        .filter(d => num(d.inbound) > 0)
        .map(d => {
          const total = num(d.inbound)
          const missed = num(d.missed)
          return {
            label: d.label,
            caption: String(total),
            parts: [
              { value: total - missed, tone: 'good' as Tone, label: 'Answered' },
              { value: missed, tone: 'bad' as Tone, label: 'Missed' },
            ],
          }
        })
      return {
        kind: 'stacked',
        title: 'Calls by Day of Week',
        sub: `${win.phrase} · business time`,
        rows,
        legend: [{ label: 'Answered', tone: 'good' }, { label: 'Missed', tone: 'bad' }],
        empty: 'No inbound calls in this period',
      }
    },
  },

  {
    type: 'comms_insights',
    group: 'Communications',
    title: 'What the Numbers Say',
    blurb: 'Plain-language read of responsiveness',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [commsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = comms(bag, win)
      const items: string[] = []

      if (!r || num(r.inbound_calls) === 0) {
        return {
          kind: 'list',
          title: 'What the Numbers Say',
          sub: '',
          items: [],
          empty: `No calls or texts in ${win.phrase}`,
        }
      }

      items.push(`${num(r.inbound_calls).toLocaleString()} calls came in ${win.phrase}. A person answered ${num(r.answered_human).toLocaleString()}${num(r.answered_ai) > 0 ? `, the assistant handled ${num(r.answered_ai).toLocaleString()}` : ''}, and ${num(r.missed).toLocaleString()} went unanswered.`)

      if (num(r.missed) > 0) {
        items.push(`Of the ${num(r.missed).toLocaleString()} missed, ${num(r.missed_with_voicemail)} left a voicemail and ${num(r.missed_no_message)} left nothing. ${num(r.missed_quick_hangup)} of them hung up within five seconds, which usually means a wrong number rather than a customer you lost — the ${num(r.missed_no_message)} silent ones are the group actually worth chasing.`)
      }

      if (r.median_answer_sec != null) {
        items.push(`When someone does pick up it takes ${dur(r.median_answer_sec)} typically — fast. The problem on this page is not how quickly you answer, it is how often nobody does.`)
      }

      if (r.median_reply_sec != null) {
        items.push(`Texts get a reply in ${dur(r.median_reply_sec)} typically, but the slowest tenth wait ${dur(r.p90_reply_sec)}. That gap is where a lead goes cold.`)
      }

      if (num(r.texts_failed) > 0) {
        items.push(`⚠ ${num(r.texts_failed)} outbound texts failed to deliver. Those customers never got the message and nothing tells them so.`)
      }

      if (num(r.voicemails_unheard) > 0) {
        items.push(`⚠ ${num(r.voicemails_unheard)} voicemail${num(r.voicemails_unheard) === 1 ? ' is' : 's are'} still unheard.`)
      }

      const worstHour = (r.by_hour ?? []).slice().sort((a, b) => num(b.missed) - num(a.missed))[0]
      if (worstHour && num(worstHour.missed) > 0) {
        const h = num(worstHour.hour)
        const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`
        items.push(`The ${label} hour misses the most calls (${num(worstHour.missed)} of ${num(worstHour.inbound)}) — the clearest place to add cover.`)
      }

      /* The phone and texting only started recording in late May, so a wider window
       * is missing history rather than genuinely quiet. */
      if (r.coverage.first_call && win.start < r.coverage.first_call) {
        items.push(`Note: call history here starts ${new Date(`${r.coverage.first_call}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}. Your date range begins before that, so anything earlier is missing from this page rather than genuinely zero.`)
      }

      return { kind: 'list', title: 'What the Numbers Say', sub: `Read of ${win.phrase}`, items }
    },
  },
]

/** The arrangement Report §8.10 ships with. */
export const COMMS_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_inbound_calls', span: 3 },
  { type: 'kpi_missed_rate', span: 3 },
  { type: 'kpi_speed_to_answer', span: 3 },
  { type: 'kpi_text_response', span: 3 },
  { type: 'kpi_text_volume', span: 3 },
  { type: 'kpi_voicemails', span: 3 },
  { type: 'comms_insights', span: 12 },
  { type: 'call_outcomes', span: 6 },
  { type: 'calls_by_hour', span: 6 },
  { type: 'calls_by_weekday', span: 6 },
]
