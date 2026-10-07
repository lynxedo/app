import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'
import { loadRachioDevices, rachioToInspection, rankRachioDevices, resolveRachioKey } from '@/lib/rachio'

// Import from Rachio (Ben, Oct 7 2026) — read-only, the company's Rachio key.
//   GET  … /irrigation/:inspId/rachio            → { controllers } nearest the customer's property first
//   POST … /irrigation/:inspId/rachio { deviceId } → { import } the form merges into BLANK fields only
// Same grant as editing the inspection (can_access_irrigation, admins always).

type Ctx = { params: Promise<{ id: string; inspId: string }> }

async function gate(ctx: Ctx) {
  const { id: contactId } = await ctx.params
  const access = await resolveIrrigationAccess()
  if ('error' in access) return { error: access.error }
  if (!access.canEdit) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const key = await resolveRachioKey(admin, access.companyId)
  if (!key) return { error: NextResponse.json({ error: 'Rachio isn’t connected yet — an admin adds the company’s Rachio API key in Admin → Integrations.', code: 'not_connected' }, { status: 400 }) }
  return { admin, access, contactId, key }
}

/** Where the customer's property is (first Jobber property with coordinates). */
async function propertyPoint(admin: ReturnType<typeof createAdminClient>, companyId: string, contactId: string): Promise<{ lat: number; lng: number } | null> {
  const { data: c } = await admin.from('txt_contacts').select('jobber_client_id').eq('id', contactId).maybeSingle()
  if (!c?.jobber_client_id) return null
  const { data: cl } = await admin.from('clients').select('id').eq('company_id', companyId).eq('external_id', c.jobber_client_id).maybeSingle()
  if (!cl) return null
  const { data: props } = await admin.from('properties').select('latitude, longitude').eq('company_id', companyId).eq('client_id', cl.id).is('deleted_at', null)
  const p = (props ?? []).find(x => x.latitude != null && x.longitude != null)
  return p ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null
}

export async function GET(_req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const devices = await loadRachioDevices(g.key, g.access.companyId)
  if ('error' in devices) return NextResponse.json({ error: devices.error }, { status: 502 })
  const at = await propertyPoint(g.admin, g.access.companyId, g.contactId)
  return NextResponse.json({ controllers: rankRachioDevices(devices, at), located: !!at })
}

export async function POST(request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({})) as { deviceId?: unknown }
  if (typeof body.deviceId !== 'string' || !body.deviceId) return NextResponse.json({ error: 'Pick a controller' }, { status: 400 })
  const devices = await loadRachioDevices(g.key, g.access.companyId)
  if ('error' in devices) return NextResponse.json({ error: devices.error }, { status: 502 })
  const d = devices.find(x => x.id === body.deviceId)
  if (!d) return NextResponse.json({ error: 'That controller isn’t on the company’s Rachio account any more.' }, { status: 404 })
  return NextResponse.json({ import: rachioToInspection(d) })
}
