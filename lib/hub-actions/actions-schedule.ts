// Schedule actions: get_schedule.
//
// Reads the LOCAL Jobber mirror (visits/clients), not the live Jobber API. The
// mirror is webhook-updated plus a nightly sweep, so it is near-live, and it
// works for any tenant without a Jobber OAuth round-trip on every question.
// A tenant with no Jobber connection simply has no visits, and we say so.

import type { HubAction } from './types'
import { limitArg, str } from './types'
import { addDays, dayLabel, lines, opsYmd, resolveDateArg } from './format'

type VisitRow = {
  id: string
  title: string | null
  scheduled_date: string | null
  start_at: string | null
  visit_status: string | null
  completed_at: string | null
  total: number | null
  client_id: string | null
  tech_external_user_ids: string[] | null
}

export const getScheduleAction: HubAction = {
  name: 'get_schedule',
  description:
    'The work schedule for a day or a date range: which visits are booked, for which customer, and ' +
    'whether they are done. Use this for "what\'s on the schedule today?", "how many stops tomorrow?", ' +
    'or "what did we do Monday?". Accepts "today", "tomorrow", "yesterday", or YYYY-MM-DD. Never guess ' +
    'a schedule — always call this.',
  input_schema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'The day to look at: "today", "tomorrow", "yesterday", or YYYY-MM-DD.',
      },
      end_date: {
        type: 'string',
        description: 'Optional last day of a range (YYYY-MM-DD). Omit for a single day.',
      },
      limit: { type: 'number', description: 'Max visits to list (default 25, max 100).' },
    },
    required: ['date'],
  },
  kind: 'read',
  gate: null,
  consentLabel: 'read your work schedule',
  run: async (ctx, args) => {
    const start = resolveDateArg(str(args, 'date'))
    if (!start) {
      return 'I need a specific day: "today", "tomorrow", "yesterday", or a YYYY-MM-DD date. Ask which day they mean.'
    }
    const endRaw = str(args, 'end_date')
    let end = endRaw ? resolveDateArg(endRaw) : start
    if (!end) end = start
    if (end < start) end = start
    // Bound the window so a wide range can't pull the whole year.
    const maxEnd = addDays(start, 60)
    if (end > maxEnd) end = maxEnd

    const limit = limitArg(args, 25, 100)

    const { data } = await ctx.admin
      .from('visits')
      .select(
        'id, title, scheduled_date, start_at, visit_status, completed_at, total, client_id, tech_external_user_ids',
      )
      .eq('company_id', ctx.actor.companyId)
      .is('deleted_at', null)
      .gte('scheduled_date', start)
      .lte('scheduled_date', end)
      .order('scheduled_date', { ascending: true })
      .order('start_at', { ascending: true, nullsFirst: true })
      .limit(limit)

    const visits = (data || []) as VisitRow[]
    const rangeLabel = start === end ? dayLabel(start) : `${dayLabel(start)} through ${dayLabel(end)}`
    if (visits.length === 0) {
      return `No visits are on the schedule for ${rangeLabel}. (If this company doesn't use Jobber, the schedule will always be empty here.)`
    }

    // Resolve customer names in one batch rather than per row.
    const clientIds = [...new Set(visits.map((v) => v.client_id).filter((id): id is string => Boolean(id)))]
    const nameById = new Map<string, string>()
    if (clientIds.length) {
      const { data: clients } = await ctx.admin
        .from('clients')
        .select('id, name, company_name')
        .eq('company_id', ctx.actor.companyId)
        .in('id', clientIds)
      for (const c of (clients || []) as Array<{ id: string; name: string | null; company_name: string | null }>) {
        nameById.set(c.id, (c.name || c.company_name || 'Unnamed customer').trim())
      }
    }

    const done = visits.filter((v) => v.completed_at).length
    const header = `${visits.length} visit${visits.length === 1 ? '' : 's'} on ${rangeLabel} — ${done} completed, ${visits.length - done} remaining.`

    const body = visits
      .map((v) => {
        const who = v.client_id ? nameById.get(v.client_id) || 'Unknown customer' : 'Unknown customer'
        const when = v.scheduled_date ? dayLabel(v.scheduled_date) : 'unscheduled'
        const time = v.start_at
          ? new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Chicago',
              hour: 'numeric',
              minute: '2-digit',
            }).format(new Date(v.start_at))
          : null
        const state = v.completed_at ? 'done' : (v.visit_status || 'scheduled').toLowerCase()
        return `• ${when}${time ? ` ${time}` : ''} — ${who}${v.title ? ` · ${v.title}` : ''} [${state}]`
      })
      .join('\n')

    const truncated = visits.length === limit ? `\n(Showing the first ${limit}; there may be more.)` : ''
    return lines(header, body) + truncated
  },
}

/** Exposed for the overview action's "today" convenience. */
export const todayYmd = opsYmd
