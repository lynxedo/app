import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'
import { loadRachioDevice, resolveRachioKey, startRachioZone, stopRachioWater, testRunZones, TEST_RUN_SECONDS } from '@/lib/rachio'

// ▶ Test run zones on an irrigation inspection (Ben, Oct 8 2026: "start a quick
// run of each zone running in sequence for 2 mins each … skip to the next zone
// … a stop button"). The phone steps through the zones; each start carries its
// own 2-minute limit, so the controller shuts every zone off by itself.
//   GET  ?deviceId=                         → { controller, zones }
//   POST { action: 'zone', deviceId, zoneId } → runs that zone for 2 min (stops anything running first)
//   POST { action: 'stop', deviceId }         → stops all watering
// Same grant as editing the inspection. Every command is logged (rachio_actions).

type Ctx = { params: Promise<{ id: string; inspId: string }> }

async function gate(ctx: Ctx) {
  const { id: contactId, inspId } = await ctx.params
  const access = await resolveIrrigationAccess()
  if ('error' in access) return { error: access.error }
  if (!access.canEdit) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const key = await resolveRachioKey(admin, access.companyId)
  if (!key) return { error: NextResponse.json({ error: 'Rachio isn’t connected — an admin adds the key in Admin → Integrations.', code: 'not_connected' }, { status: 400 }) }
  return { admin, access, contactId, inspId, key }
}

export async function GET(request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const deviceId = new URL(request.url).searchParams.get('deviceId') ?? ''
  if (!deviceId) return NextResponse.json({ error: 'Pick a controller' }, { status: 400 })
  const d = await loadRachioDevice(g.key, deviceId)
  if ('error' in d) return NextResponse.json({ error: d.error }, { status: 502 })
  return NextResponse.json({
    controller: { id: d.id, name: (d.name || 'Rachio controller').trim(), online: d.status ? d.status === 'ONLINE' : true },
    zones: testRunZones(d),
    seconds: TEST_RUN_SECONDS,
  })
}

export async function POST(request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({})) as { action?: unknown; deviceId?: unknown; zoneId?: unknown }
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
  if (!deviceId) return NextResponse.json({ error: 'Pick a controller' }, { status: 400 })
  const log = (row: Record<string, unknown>) => g.admin.from('rachio_actions').insert({
    company_id: g.access.companyId, user_id: g.access.userId, contact_id: g.contactId,
    inspection_id: /^[0-9a-f-]{36}$/i.test(g.inspId) ? g.inspId : null, device_id: deviceId, ...row,
  })

  if (body.action === 'stop') {
    const r = await stopRachioWater(g.key, deviceId)
    await log({ action: 'stop', ok: r.ok, error: r.ok ? null : r.message })
    if (!r.ok) return NextResponse.json({ error: `Couldn’t stop the controller: ${r.message}. Stop it in the Rachio app.` }, { status: 502 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'zone') {
    const zoneId = typeof body.zoneId === 'string' ? body.zoneId : ''
    // The zone must belong to this controller (and the controller to the account).
    const d = await loadRachioDevice(g.key, deviceId)
    if ('error' in d) return NextResponse.json({ error: d.error }, { status: 502 })
    const zone = testRunZones(d).find(z => z.id === zoneId)
    if (!zone) return NextResponse.json({ error: 'That zone isn’t on this controller.' }, { status: 400 })
    const r = await startRachioZone(g.key, deviceId, zoneId, TEST_RUN_SECONDS)
    await log({ action: 'zone_start', zone_id: zoneId, zone_number: zone.number, seconds: TEST_RUN_SECONDS, ok: r.ok, error: r.ok ? null : r.message })
    if (!r.ok) return NextResponse.json({ error: `Couldn’t start zone ${zone.number}: ${r.message}` }, { status: 502 })
    return NextResponse.json({ ok: true, seconds: TEST_RUN_SECONDS })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
