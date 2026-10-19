import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { companyJobberUserId } from '@/lib/jobber'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchTechDayStops, type DayStop } from '@/lib/jobber-day-stops'
import { normalizeDispatchSettings, type DispatchStop } from '@/lib/dispatch'
import { DEFAULT_DURATION_RULES, type DurationRulesConfig } from '@/app/api/settings/types'

// Dispatch Day view — every chosen tech's day, read LIVE from Jobber the same way
// the Route Optimizer reads it (lib/jobber-day-stops), plus what Hub keeps on
// the side: locked time frames, the unsent draft, depot, service minutes and the
// Dispatch settings. One request so the screen paints in one go.

const MAX_TECHS = 8
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function toDispatchStop(s: DayStop, techId: string): DispatchStop {
  return {
    id: s.id,
    kind: s.type,
    clientName: s.clientName,
    phone: s.phone,
    address: s.addressString,
    routable: s.routable,
    title: (s.visitTitle ?? '').trim() || s.jobTitle,
    lineItemNames: s.lineItemNames,
    totalPrice: s.totalPrice,
    instructions: s.instructions,
    startAt: s.startAt,
    endAt: s.endAt,
    // Tasks already come back with startAt=null when all-day.
    allDay: s.allDay === true || (s.type === 'task' && !s.startAt),
    isComplete: s.isComplete === true,
    arrivalStart: s.arrivalStart ?? null,
    arrivalEnd: s.arrivalEnd ?? null,
    techIds: [techId],
  }
}

export async function GET(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date') ?? ''
  const techIds = (searchParams.get('techIds') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_TECHS)
  if (!DATE_RE.test(date)) return NextResponse.json({ error: 'date (YYYY-MM-DD) is required' }, { status: 400 })

  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })

  const admin = createAdminClient()

  const [settingsRes, techSettingsRes, draftRes, ...dayResults] = await Promise.all([
    admin.from('company_routing_settings')
      .select('depot_address, depot_lat, depot_lng, default_service_minutes, duration_method, duration_rules, dispatch_settings')
      .eq('company_id', companyId).maybeSingle(),
    admin.from('dispatch_tech_settings').select('*').eq('company_id', companyId),
    admin.from('dispatch_drafts').select('changes, updated_by, updated_at').eq('company_id', companyId).eq('draft_date', date).maybeSingle(),
    ...techIds.map(t => fetchTechDayStops(jobberUserId, date, t, { extended: true })
      .catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'Jobber request failed' }))),
  ])

  // A stop assigned to two techs comes back once per tech — keep one, list both.
  const byId = new Map<string, DispatchStop>()
  const errors: Array<{ techId: string; error: string }> = []
  let truncated = false
  dayResults.forEach((r, i) => {
    const techId = techIds[i]
    if ('error' in r) { errors.push({ techId, error: r.error }); return }
    if (r.truncated) truncated = true
    for (const s of r.stops) {
      const existing = byId.get(s.id)
      if (existing) { if (!existing.techIds.includes(techId)) existing.techIds.push(techId) }
      else byId.set(s.id, toDispatchStop(s, techId))
    }
  })
  const stops = [...byId.values()]

  const ids = stops.map(s => s.id)
  const locks = ids.length
    ? (await admin.from('dispatch_visit_locks')
        .select('jobber_item_id, item_kind, window_start, window_end, locked_source, note')
        .eq('company_id', companyId).in('jobber_item_id', ids)).data ?? []
    : []

  // Who last touched the draft, for "Ben has 3 unsent changes".
  let draftBy: string | null = null
  if (draftRes.data?.updated_by) {
    const { data: hu } = await admin.from('hub_users').select('display_name').eq('id', draftRes.data.updated_by).maybeSingle()
    draftBy = (hu?.display_name as string | undefined) ?? null
  }

  const s = settingsRes.data
  return NextResponse.json({
    date,
    stops,
    locks,
    errors,
    truncated,
    draft: draftRes.data
      ? { changes: draftRes.data.changes ?? [], updatedBy: draftRes.data.updated_by, updatedByName: draftBy, updatedAt: draftRes.data.updated_at, mine: draftRes.data.updated_by === userId }
      : null,
    depot: s?.depot_lat != null && s?.depot_lng != null
      ? { lat: s.depot_lat as number, lng: s.depot_lng as number, address: (s.depot_address as string | null) ?? null }
      : null,
    duration: {
      method: (s?.duration_method as string | undefined) ?? 'default',
      defaultMinutes: (s?.default_service_minutes as number | undefined) ?? 30,
      rules: { ...DEFAULT_DURATION_RULES, ...((s?.duration_rules as Partial<DurationRulesConfig>) ?? {}) },
    },
    settings: normalizeDispatchSettings(s?.dispatch_settings),
    techSettings: techSettingsRes.data ?? [],
  })
}
