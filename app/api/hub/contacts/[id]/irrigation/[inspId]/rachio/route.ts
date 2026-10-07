import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'
import { loadRachioDevice, loadRachioDevices, rachioToInspection, rankRachioDevices, resolveRachioKey, type RachioCustomerHint } from '@/lib/rachio'
import { geocodeAddresses } from '@/lib/geocode'

// Import from Rachio (Ben, Oct 7 2026) — read-only, the company's Rachio key.
//   GET  … /irrigation/:inspId/rachio            → { controllers } nearest the customer's property first
//   POST … /irrigation/:inspId/rachio { deviceId } → { import } the form merges into BLANK fields only
// Same grant as editing the inspection (can_access_irrigation, admins always).

// The first read of a big Rachio account takes ~20 s (see lib/rachio.ts).
export const maxDuration = 90

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

/**
 * Who / where the customer is, to find their controller: name + street from the
 * customer file and the Jobber property; location from a work-order stop's pin,
 * else the geocoded property address (Jobber properties carry no coordinates).
 */
async function customerHint(admin: ReturnType<typeof createAdminClient>, companyId: string, contactId: string): Promise<RachioCustomerHint> {
  const { data: c } = await admin.from('txt_contacts').select('name, first_name, last_name, jobber_client_id, address_line1, city, state, postal_code').eq('id', contactId).maybeSingle()
  const full = String(c?.name ?? '').trim()
  const lastName = String(c?.last_name ?? '').trim() || full.split(/\s+/).slice(-1)[0] || ''
  const firstName = String(c?.first_name ?? '').trim() || (full.split(/\s+/).length > 1 ? full.split(/\s+/)[0] : '')
  let street = String(c?.address_line1 ?? '').trim()
  let address = [street, c?.city, c?.state, c?.postal_code].filter(Boolean).join(', ')
  if (c?.jobber_client_id) {
    const { data: cl } = await admin.from('clients').select('id').eq('company_id', companyId).eq('external_id', c.jobber_client_id).maybeSingle()
    if (cl) {
      const { data: props } = await admin.from('properties').select('address_line1, city, state, zip').eq('company_id', companyId).eq('client_id', cl.id).is('deleted_at', null).limit(1)
      const p = props?.[0]
      if (p?.address_line1) { street = String(p.address_line1); address = [p.address_line1, p.city, p.state, p.zip].filter(Boolean).join(', ') }
    }
  }
  let at: { lat: number; lng: number } | null = null
  const { data: stop } = await admin.from('daily_log_stops').select('lat, lng').eq('contact_id', contactId).not('lat', 'is', null).not('lng', 'is', null).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (stop?.lat != null && stop?.lng != null) at = { lat: Number(stop.lat), lng: Number(stop.lng) }
  else if (address) {
    try { const [g] = await geocodeAddresses([address]); if (g) at = { lat: g.lat, lng: g.lng } } catch { /* no location — rank by name */ }
  }
  return { lastName, firstName, street, at }
}

export async function GET(_req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const devices = await loadRachioDevices(g.key, g.access.companyId)
  if ('error' in devices) return NextResponse.json({ error: devices.error }, { status: 502 })
  const hint = await customerHint(g.admin, g.access.companyId, g.contactId)
  return NextResponse.json({ controllers: rankRachioDevices(devices, hint), located: !!hint.at })
}

export async function POST(request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({})) as { deviceId?: unknown }
  if (typeof body.deviceId !== 'string' || !body.deviceId) return NextResponse.json({ error: 'Pick a controller' }, { status: 400 })
  const d = await loadRachioDevice(g.key, body.deviceId)
  if ('error' in d) return NextResponse.json({ error: d.error }, { status: 502 })
  return NextResponse.json({ import: rachioToInspection(d) })
}
