import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { getFleetDevices } from '@/lib/onestepgps'
import { loadAssignmentRows } from '@/lib/fleet-assignments'

export const dynamic = 'force-dynamic'

// Admin → Fleet → "Who drives which truck" (Fleet stops PRD session 1).
// GET  — the trucks, the people, and the standing + today's assignments.
// POST — { device_id, scope: 'standing' | 'today', user_id: uuid | null | 'usual' }
//   standing + uuid  → that person usually drives this truck (moved off any other)
//   standing + null  → nobody usually drives this truck
//   today    + uuid  → that person drives this truck today only
//   today    + null  → nobody drives this truck today
//   today    + 'usual' → drop today's change; the usual driver is back
// Writes are delete-then-insert (not upsert): the unique indexes are partial /
// NULLS NOT DISTINCT, which PostgREST's onConflict can't target.

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

const UUID_RE = /^[0-9a-f-]{36}$/i

export async function GET() {
  const check = await requireAdminArea('fleet')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const companyId = check.company_id
  const today = chicagoToday()
  const admin = createAdminClient()

  const [devicesResult, { data: people }, rows] = await Promise.all([
    getFleetDevices(companyId)
      .then((d) => ({ devices: d.map((x) => ({ id: x.id, name: x.name })), error: null as string | null }))
      .catch((err) => ({ devices: [] as { id: string; name: string }[], error: err instanceof Error ? err.message : String(err) })),
    admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', companyId)
      .eq('is_bot', false)
      .order('display_name'),
    loadAssignmentRows(admin, companyId, today),
  ])

  return NextResponse.json({
    today,
    devices: devicesResult.devices,
    devices_error: devicesResult.error,
    people: people ?? [],
    assignments: rows,
  })
}

export async function POST(request: Request) {
  const check = await requireAdminArea('fleet')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const companyId = check.company_id

  let body: { device_id?: unknown; scope?: unknown; user_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : ''
  if (!deviceId || deviceId.length > 100) {
    return NextResponse.json({ error: 'device_id is required' }, { status: 400 })
  }
  const scope = body.scope
  if (scope !== 'standing' && scope !== 'today') {
    return NextResponse.json({ error: "scope must be 'standing' or 'today'" }, { status: 400 })
  }
  const rawUser = body.user_id
  const userId = typeof rawUser === 'string' && UUID_RE.test(rawUser) ? rawUser : null
  const usual = rawUser === 'usual'
  if (rawUser !== null && !userId && !(usual && scope === 'today')) {
    return NextResponse.json({ error: 'user_id must be a person, null, or (today only) "usual"' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (userId) {
    const { data: person } = await admin
      .from('hub_users')
      .select('id')
      .eq('id', userId)
      .eq('company_id', companyId)
      .eq('is_bot', false)
      .maybeSingle()
    if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const effectiveDate = scope === 'today' ? chicagoToday() : null

  // Clear this truck's row for the scope (and, when assigning, the person's
  // row on any other truck for the same scope — one truck per person).
  const clearDevice = admin
    .from('fleet_vehicle_assignments')
    .delete()
    .eq('company_id', companyId)
    .eq('device_id', deviceId)
  const { error: delErr } = await (effectiveDate
    ? clearDevice.eq('effective_date', effectiveDate)
    : clearDevice.is('effective_date', null))
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (userId) {
    const clearUser = admin
      .from('fleet_vehicle_assignments')
      .delete()
      .eq('company_id', companyId)
      .eq('user_id', userId)
    const { error: delUserErr } = await (effectiveDate
      ? clearUser.eq('effective_date', effectiveDate)
      : clearUser.is('effective_date', null))
    if (delUserErr) return NextResponse.json({ error: delUserErr.message }, { status: 500 })
  }

  // A standing "nobody" is just no row; today's "nobody" is a row with no person.
  const insert = userId || (scope === 'today' && !usual)
  if (insert) {
    const { error: insErr } = await admin.from('fleet_vehicle_assignments').insert({
      company_id: companyId,
      device_id: deviceId,
      user_id: userId,
      effective_date: effectiveDate,
      created_by: check.user?.id ?? null,
    })
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  const rows = await loadAssignmentRows(admin, companyId, chicagoToday())
  return NextResponse.json({ assignments: rows })
}
