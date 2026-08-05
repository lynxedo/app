// Call + voicemail actions: get_call_activity.

import type { HubAction } from './types'
import { limitArg, str } from './types'
import { clip, lines, phone, stampLabel } from './format'

const CALL_GATE = {
  anyFlag: ['can_access_call_log', 'can_access_call_log2', 'can_access_dialer', 'can_admin_dialer'],
}

export const callActivityAction: HubAction = {
  name: 'get_call_activity',
  description:
    'Recent phone activity: calls in and out, missed calls, and voicemails — including which voicemails ' +
    'still need follow-up. Use this for "did anyone call while I was out?", "any missed calls today?", ' +
    'or "what voicemails are waiting?".',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['all', 'missed', 'voicemails'],
        description: 'Which activity to show. "voicemails" lists voicemails needing follow-up first.',
      },
      hours: { type: 'number', description: 'How far back to look, in hours (default 24, max 336).' },
      limit: { type: 'number', description: 'Max rows (default 10, max 40).' },
    },
    required: [],
  },
  kind: 'read',
  gate: CALL_GATE,
  consentLabel: 'read call and voicemail activity',
  run: async (ctx, args) => {
    const kindArg = str(args, 'kind').toLowerCase()
    const kind = kindArg === 'missed' || kindArg === 'voicemails' ? kindArg : 'all'
    const hours = Math.max(1, Math.min(336, Math.round(Number(args.hours) || 24)))
    const limit = limitArg(args, 10, 40)
    const since = new Date(Date.now() - hours * 3600_000).toISOString()
    const windowLabel = hours === 24 ? 'the last 24 hours' : `the last ${hours} hours`

    if (kind === 'voicemails') {
      const { data } = await ctx.admin
        .from('voicemails')
        .select('id, from_number, contact_id, transcript, summary, heard_at, follow_up_status, created_at')
        .eq('company_id', ctx.actor.companyId)
        .is('deleted_at', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit)
      const vms = (data || []) as Array<{
        id: string
        from_number: string | null
        transcript: string | null
        summary: string | null
        heard_at: string | null
        follow_up_status: string | null
        created_at: string
      }>
      if (vms.length === 0) return `No voicemails in ${windowLabel}.`

      const needing = vms.filter((v) => v.follow_up_status !== 'done' && v.follow_up_status !== 'taken_care_of')
      return lines(
        `${vms.length} voicemail${vms.length === 1 ? '' : 's'} in ${windowLabel}; ${needing.length} not marked taken care of.`,
        ...vms.map((v) =>
          lines(
            `• ${phone(v.from_number)} · ${stampLabel(v.created_at)}${v.heard_at ? '' : ' · UNHEARD'}` +
              `${v.follow_up_status ? ` · follow-up: ${v.follow_up_status}` : ''}`,
            v.summary || v.transcript ? `  ${clip(v.summary || v.transcript || '', 240)}` : null,
          ),
        ),
      )
    }

    let q = ctx.admin
      .from('calls')
      .select(
        'id, direction, from_number, to_number, status, duration_seconds, created_at, ai_summary, handled_by, handled_by_ai, transferred_to_user_id',
      )
      .eq('company_id', ctx.actor.companyId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit)

    // A "missed" call is an inbound call that never connected. Statuses vary by
    // provider path, so match the set the Call Log itself treats as missed.
    if (kind === 'missed') {
      q = q.eq('direction', 'inbound').in('status', ['no-answer', 'missed', 'busy', 'failed', 'canceled'])
    }

    const { data } = await q
    const calls = (data || []) as Array<{
      direction: string
      from_number: string | null
      to_number: string | null
      status: string | null
      duration_seconds: number | null
      created_at: string
      ai_summary: string | null
      handled_by: string | null
      handled_by_ai: boolean | null
      transferred_to_user_id: string | null
    }>
    if (calls.length === 0) {
      return kind === 'missed' ? `No missed calls in ${windowLabel}.` : `No call activity in ${windowLabel}.`
    }

    // Resolve who handled each call (the human who took a transfer wins over the
    // stamped agent — same rule the Call Log and coaching use).
    const userIds = [
      ...new Set(
        calls
          .flatMap((c) => [c.transferred_to_user_id, c.handled_by])
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    const nameById = new Map<string, string>()
    if (userIds.length) {
      const { data: users } = await ctx.admin.from('hub_users').select('id, display_name').in('id', userIds)
      for (const u of (users || []) as Array<{ id: string; display_name: string | null }>) {
        nameById.set(u.id, (u.display_name || 'someone').trim())
      }
    }

    return lines(
      `${calls.length} ${kind === 'missed' ? 'missed call' : 'call'}${calls.length === 1 ? '' : 's'} in ${windowLabel}:`,
      ...calls.map((c) => {
        const other = c.direction === 'inbound' ? c.from_number : c.to_number
        const agentId = c.transferred_to_user_id || c.handled_by
        const agent = agentId ? nameById.get(agentId) || null : null
        return lines(
          `• ${c.direction} · ${phone(other)} · ${stampLabel(c.created_at)} · ${c.status || 'unknown'}` +
            `${c.duration_seconds ? ` · ${c.duration_seconds}s` : ''}` +
            `${agent ? ` · handled by ${agent}` : ''}`,
          c.ai_summary ? `  ${clip(c.ai_summary, 220)}` : null,
        )
      }),
    )
  },
}
