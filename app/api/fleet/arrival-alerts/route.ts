import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALERT_KINDS, STANDING_KINDS, alertLabel, type AlertKind } from '@/lib/fleet-visits'

export const dynamic = 'force-dynamic'

// "My alerts" on the Fleet map (Fleet stops PRD session 3). Anyone with Fleet
// access sets up their own alerts; each has its own on/off (Ben, Oct 8 2026).
// Every call works only on the CALLER's own alerts.
//
// GET    → { alerts, company_on }
// POST   { kind, tech_user_id?, stop_id? }   → create (or turn back on a matching one)
// PATCH  { id, enabled }                     → turn on / off
// DELETE ?id=                                → remove (soft delete)

const UUID_RE = /^[0-9a-f-]{36}$/i

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

async function auth() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_fleet, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_fleet || !profile.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { userId: user.id, companyId: profile.company_id as string, admin: createAdminClient() }
}

type AlertRow = {
  id: string
  kind: AlertKind
  tech_user_id: string | null
  stop_id: string | null
  alert_date: string | null
  enabled: boolean
  created_at: string
}

export async function GET() {
  const ctx = await auth()
  if ('error' in ctx) return ctx.error
  const { admin, userId, companyId } = ctx
  const today = chicagoToday()

  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const [{ data: rows }, { data: settings }, { data: recentEntries }, { data: linked }] = await Promise.all([
    admin
      .from('fleet_arrival_alerts')
      .select('id, kind, tech_user_id, stop_id, alert_date, enabled, created_at')
      .eq('company_id', companyId)
      .eq('created_by', userId)
      .is('deleted_at', null)
      // One-stop alerts expire at the end of their day.
      .or(`alert_date.is.null,alert_date.gte.${today}`)
      .order('created_at', { ascending: true }),
    admin.from('fleet_settings').select('alert_arrivals').eq('company_id', companyId).maybeSingle(),
    // The people an alert can be about: anyone with a Work Orders day in the last
    // 30 days, plus anyone linked to a truck.
    admin
      .from('daily_log_entries')
      .select('tech_user_id')
      .eq('company_id', companyId)
      .gte('log_date', since)
      .is('deleted_at', null)
      .limit(1000),
    admin.from('fleet_vehicle_assignments').select('user_id').eq('company_id', companyId).not('user_id', 'is', null),
  ])
  const alerts = (rows ?? []) as AlertRow[]

  const pickable = new Set<string>()
  for (const e of recentEntries ?? []) if (e.tech_user_id) pickable.add(e.tech_user_id as string)
  for (const l of linked ?? []) if (l.user_id) pickable.add(l.user_id as string)
  const techIds = [...new Set([...alerts.map((a) => a.tech_user_id).filter((x): x is string => !!x), ...pickable])]
  const stopIds = [...new Set(alerts.map((a) => a.stop_id).filter((x): x is string => !!x))]
  const alertIds = alerts.map((a) => a.id)
  const [{ data: people }, { data: stops }, { data: fires }] = await Promise.all([
    techIds.length
      ? admin.from('hub_users').select('id, display_name').eq('company_id', companyId).eq('is_bot', false).in('id', techIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> }),
    stopIds.length
      ? admin.from('daily_log_stops').select('id, ord, client_name').in('id', stopIds)
      : Promise.resolve({ data: [] as Array<{ id: string; ord: number; client_name: string | null }> }),
    alertIds.length
      ? admin.from('fleet_arrival_alert_fires').select('alert_id, fired_at').in('alert_id', alertIds).order('fired_at', { ascending: false })
      : Promise.resolve({ data: [] as Array<{ alert_id: string; fired_at: string }> }),
  ])
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]))
  const stopOf = new Map((stops ?? []).map((s) => [s.id as string, s as { ord: number; client_name: string | null }]))
  const lastFired = new Map<string, string>()
  for (const f of fires ?? []) if (!lastFired.has(f.alert_id as string)) lastFired.set(f.alert_id as string, f.fired_at as string)

  return NextResponse.json({
    company_on: settings?.alert_arrivals !== false,
    techs: [...pickable]
      .filter((id) => nameOf.has(id))
      .map((id) => ({ id, name: nameOf.get(id) as string }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    alerts: alerts.map((a) => {
      const stop = a.stop_id ? stopOf.get(a.stop_id) : null
      const stopLabel = stop ? `stop ${stop.ord}${stop.client_name ? ` (${stop.client_name})` : ''}` : null
      return {
        id: a.id,
        kind: a.kind,
        tech_user_id: a.tech_user_id,
        stop_id: a.stop_id,
        alert_date: a.alert_date,
        enabled: a.enabled,
        label: alertLabel(a.kind, a.tech_user_id ? nameOf.get(a.tech_user_id) ?? 'Tech' : null, stopLabel),
        last_fired_at: lastFired.get(a.id) ?? null,
      }
    }),
  })
}

export async function POST(request: Request) {
  const ctx = await auth()
  if ('error' in ctx) return ctx.error
  const { admin, userId, companyId } = ctx

  const body = (await request.json().catch(() => null)) as { kind?: unknown; tech_user_id?: unknown; stop_id?: unknown } | null
  const kind = body?.kind as AlertKind
  if (!ALERT_KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown alert type' }, { status: 400 })

  let techId: string | null = null
  let stopId: string | null = null
  let alertDate: string | null = null

  if (STANDING_KINDS.includes(kind)) {
    if (body?.tech_user_id != null) {
      if (typeof body.tech_user_id !== 'string' || !UUID_RE.test(body.tech_user_id)) {
        return NextResponse.json({ error: 'tech_user_id must be a person or null (any tech)' }, { status: 400 })
      }
      const { data: person } = await admin
        .from('hub_users')
        .select('id')
        .eq('id', body.tech_user_id)
        .eq('company_id', companyId)
        .eq('is_bot', false)
        .maybeSingle()
      if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 })
      techId = body.tech_user_id
    }
  } else {
    // One stop, today only — and it must be one of this company's stops today.
    if (typeof body?.stop_id !== 'string' || !UUID_RE.test(body.stop_id)) {
      return NextResponse.json({ error: 'stop_id is required' }, { status: 400 })
    }
    const today = chicagoToday()
    const { data: stop } = await admin
      .from('daily_log_stops')
      .select('id, status, daily_log_entries!inner(company_id, log_date, tech_user_id)')
      .eq('id', body.stop_id)
      .maybeSingle()
    const entry = stop
      ? (Array.isArray(stop.daily_log_entries) ? stop.daily_log_entries[0] : stop.daily_log_entries) as
          | { company_id: string; log_date: string; tech_user_id: string | null }
          | undefined
      : undefined
    if (!stop || !entry || entry.company_id !== companyId) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
    }
    if (entry.log_date !== today) {
      return NextResponse.json({ error: 'Stop alerts can only be set for today’s stops' }, { status: 400 })
    }
    stopId = stop.id as string
    techId = entry.tech_user_id
    alertDate = today
  }

  // The same alert already set up → turn it back on instead of making a second.
  let existing = admin
    .from('fleet_arrival_alerts')
    .select('id, enabled')
    .eq('company_id', companyId)
    .eq('created_by', userId)
    .eq('kind', kind)
    .is('deleted_at', null)
  existing = stopId ? existing.eq('stop_id', stopId) : existing.is('stop_id', null)
  existing = techId ? existing.eq('tech_user_id', techId) : existing.is('tech_user_id', null)
  const { data: found } = await existing.limit(1).maybeSingle()
  const nowIso = new Date().toISOString()
  if (found) {
    if (!found.enabled) {
      await admin
        .from('fleet_arrival_alerts')
        .update({ enabled: true, enabled_at: nowIso, updated_at: nowIso })
        .eq('id', found.id)
    }
    return NextResponse.json({ ok: true, id: found.id })
  }

  const { data: created, error } = await admin
    .from('fleet_arrival_alerts')
    .insert({
      company_id: companyId,
      created_by: userId,
      kind,
      tech_user_id: techId,
      stop_id: stopId,
      alert_date: alertDate,
    })
    .select('id')
    .single()
  if (error || !created) return NextResponse.json({ error: error?.message ?? 'Create failed' }, { status: 500 })
  return NextResponse.json({ ok: true, id: created.id })
}

export async function PATCH(request: Request) {
  const ctx = await auth()
  if ('error' in ctx) return ctx.error
  const { admin, userId, companyId } = ctx
  const body = (await request.json().catch(() => null)) as { id?: unknown; enabled?: unknown } | null
  if (typeof body?.id !== 'string' || !UUID_RE.test(body.id) || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'id and enabled are required' }, { status: 400 })
  }
  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = { enabled: body.enabled, updated_at: nowIso }
  // Turning an alert on never replays what already happened today.
  if (body.enabled) patch.enabled_at = nowIso
  const { data, error } = await admin
    .from('fleet_arrival_alerts')
    .update(patch)
    .eq('id', body.id)
    .eq('company_id', companyId)
    .eq('created_by', userId)
    .is('deleted_at', null)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const ctx = await auth()
  if ('error' in ctx) return ctx.error
  const { admin, userId, companyId } = ctx
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from('fleet_arrival_alerts')
    .update({ deleted_at: nowIso, enabled: false, updated_at: nowIso })
    .eq('id', id)
    .eq('company_id', companyId)
    .eq('created_by', userId)
    .is('deleted_at', null)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
