// Lead Tracker actions: list_leads.

import type { HubAction } from './types'
import { limitArg, str } from './types'
import { clip, lines, phone, stampLabel } from './format'

const TRACKER_GATE = { anyFlag: ['can_access_tracker'] }

export const listLeadsAction: HubAction = {
  name: 'list_leads',
  description:
    'Leads from the Lead Tracker, newest first, optionally filtered by stage or lead source. Use this ' +
    'for "any new leads today?", "what\'s in the pipeline?", or "how many Angi leads this week?". ' +
    'Returns each lead\'s name, contact info, stage, source, and value.',
  input_schema: {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        description: 'Filter to one stage (e.g. "current", "sold", "lost"). Omit for all stages.',
      },
      source: {
        type: 'string',
        description: 'Filter to one lead source (e.g. "Angi", "Google (GBP / LSA)"). Omit for all.',
      },
      days: { type: 'number', description: 'Only leads created in the last N days (default 14, max 365).' },
      limit: { type: 'number', description: 'Max leads (default 15, max 50).' },
    },
    required: [],
  },
  kind: 'read',
  gate: TRACKER_GATE,
  consentLabel: 'read your sales leads',
  run: async (ctx, args) => {
    const stage = str(args, 'stage')
    const source = str(args, 'source')
    const days = Math.max(1, Math.min(365, Math.round(Number(args.days) || 14)))
    const limit = limitArg(args, 15, 50)
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    let q = ctx.admin
      .from('leads')
      .select(
        'id, first_name, last_name, phone, email, service, lead_source, status, stage, annual_value, service_address, created_at, stage_changed_at',
      )
      .eq('company_id', ctx.actor.companyId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (stage) q = q.ilike('stage', stage)
    if (source) q = q.ilike('lead_source', `%${source.replace(/[%_]/g, '')}%`)

    const { data } = await q
    const leads = (data || []) as Array<{
      id: string
      first_name: string | null
      last_name: string | null
      phone: string | null
      email: string | null
      service: string[] | null
      lead_source: string | null
      status: string | null
      stage: string | null
      annual_value: number | null
      service_address: string | null
      created_at: string
    }>

    if (leads.length === 0) {
      const filters = [stage ? `stage "${stage}"` : null, source ? `source "${source}"` : null]
        .filter(Boolean)
        .join(' and ')
      return `No leads in the last ${days} days${filters ? ` matching ${filters}` : ''}.`
    }

    const bySource = new Map<string, number>()
    for (const l of leads) {
      const key = l.lead_source?.trim() || 'Unknown source'
      bySource.set(key, (bySource.get(key) ?? 0) + 1)
    }
    const mix = [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')

    return lines(
      `${leads.length} lead${leads.length === 1 ? '' : 's'} in the last ${days} days. By source — ${mix}.`,
      ...leads.map((l) => {
        const name = [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'Unnamed lead'
        const svc = Array.isArray(l.service) && l.service.length ? l.service.join(', ') : null
        return lines(
          `• ${name} · ${stampLabel(l.created_at)} · stage: ${l.stage || l.status || 'unset'}` +
            `${l.lead_source ? ` · ${l.lead_source}` : ''}`,
          `  ${phone(l.phone)}${l.email ? ` · ${l.email}` : ''}`,
          svc ? `  wants: ${clip(svc, 120)}` : null,
          l.service_address ? `  at: ${clip(l.service_address, 120)}` : null,
          l.annual_value ? `  annual value: $${Number(l.annual_value).toFixed(0)}` : null,
        )
      }),
    )
  },
}
