import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDripAccess } from '@/lib/drip-auth'

const DEFAULT_QUIET = { start: 8, end: 20, tz: 'America/Chicago' }
const SETTINGS_SELECT =
  'quiet_hours, send_as_user_id, frequency_cap, business_display_name, default_sms_number_id'

// GET — the company's drip settings (defaults if unset) + the list of company
// users for the "send as" picker.
export async function GET() {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('drip_settings')
    .select(SETTINGS_SELECT)
    .eq('company_id', access.companyId)
    .maybeSingle()

  const { data: profiles } = await admin
    .from('user_profiles')
    .select('id')
    .eq('company_id', access.companyId)
    .is('deactivated_at', null)
  const ids = (profiles ?? []).map((p) => p.id)
  const users: { id: string; display_name: string }[] = []
  if (ids.length) {
    const { data: hu } = await admin.from('hub_users').select('id, display_name').in('id', ids)
    const nameById: Record<string, string> = {}
    for (const h of hu ?? []) nameById[h.id] = h.display_name
    for (const uid of ids) users.push({ id: uid, display_name: nameById[uid] || 'User' })
    users.sort((a, b) => a.display_name.localeCompare(b.display_name))
  }

  return NextResponse.json({
    settings: settings ?? {
      quiet_hours: DEFAULT_QUIET,
      send_as_user_id: null,
      frequency_cap: 6,
      business_display_name: null,
      default_sms_number_id: null,
    },
    users,
  })
}

// PUT — upsert the company's drip settings (partial; only provided fields change).
export async function PUT(request: Request) {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({} as any))
  const admin = createAdminClient()
  const update: Record<string, unknown> = { company_id: access.companyId, updated_at: new Date().toISOString() }

  if (body.quiet_hours && typeof body.quiet_hours === 'object') {
    const start = Number(body.quiet_hours.start)
    const end = Number(body.quiet_hours.end)
    update.quiet_hours = {
      start: start >= 0 && start <= 23 ? Math.round(start) : 8,
      end: end >= 1 && end <= 24 ? Math.round(end) : 20,
      tz: typeof body.quiet_hours.tz === 'string' && body.quiet_hours.tz ? body.quiet_hours.tz : 'America/Chicago',
    }
  }
  if ('send_as_user_id' in body) {
    const uid = typeof body.send_as_user_id === 'string' && body.send_as_user_id ? body.send_as_user_id : null
    if (uid) {
      const { data: p } = await admin
        .from('user_profiles')
        .select('id')
        .eq('id', uid)
        .eq('company_id', access.companyId)
        .maybeSingle()
      update.send_as_user_id = p ? uid : null
    } else {
      update.send_as_user_id = null
    }
  }
  if ('frequency_cap' in body) {
    const n = Number(body.frequency_cap)
    update.frequency_cap = n >= 1 && n <= 50 ? Math.round(n) : 6
  }
  if ('business_display_name' in body) {
    update.business_display_name =
      typeof body.business_display_name === 'string' ? body.business_display_name.trim() || null : null
  }
  if ('default_sms_number_id' in body) {
    update.default_sms_number_id =
      typeof body.default_sms_number_id === 'string' && body.default_sms_number_id ? body.default_sms_number_id : null
  }

  const { error } = await admin.from('drip_settings').upsert(update, { onConflict: 'company_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
