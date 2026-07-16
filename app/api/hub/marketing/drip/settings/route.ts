import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDripAccess } from '@/lib/drip-auth'
import { listSendingIdentities, validIdentityId } from '@/lib/email-identities'

const DEFAULT_QUIET = { start: 8, end: 20, tz: 'America/Chicago' }
// Columns from the applied drip_engine migration (safe to select directly).
const SETTINGS_SELECT =
  'quiet_hours, send_as_user_id, frequency_cap, business_display_name, default_sms_number_id, default_email_identity_id, rvm_enabled, rvm_consent_confirmed'

// GET — the company's drip settings (defaults if unset) + the "send as" user list
// + the verified email sending identities for the "Send from" pickers.
export async function GET() {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('drip_settings')
    .select(SETTINGS_SELECT)
    .eq('company_id', access.companyId)
    .maybeSingle()

  // rvm_caller_id lives on drip_settings (drip_rvm migration); text_autonomy (Amber
  // autonomy) lives on voice_receptionist_settings where Amber reads it. Read both via
  // `as any` since these additive columns aren't in lib/database.types.ts yet. TODO regen.
  const { data: dripExtra } = await (admin as any)
    .from('drip_settings')
    .select('rvm_caller_id')
    .eq('company_id', access.companyId)
    .maybeSingle()
  const { data: vrs } = await (admin as any)
    .from('voice_receptionist_settings')
    .select('text_autonomy')
    .eq('company_id', access.companyId)
    .maybeSingle()

  const base = (settings ?? {}) as any
  const merged = {
    quiet_hours: base.quiet_hours ?? DEFAULT_QUIET,
    send_as_user_id: base.send_as_user_id ?? null,
    frequency_cap: typeof base.frequency_cap === 'number' ? base.frequency_cap : 6,
    business_display_name: base.business_display_name ?? null,
    default_sms_number_id: base.default_sms_number_id ?? null,
    default_email_identity_id: base.default_email_identity_id ?? null,
    rvm_enabled: base.rvm_enabled === true,
    rvm_consent_confirmed: base.rvm_consent_confirmed === true,
    rvm_caller_id: (dripExtra as any)?.rvm_caller_id ?? null,
    text_autonomy: ((vrs as any)?.text_autonomy as string) || 'draft',
  }

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

  const email_identities = await listSendingIdentities(admin, access.companyId)

  return NextResponse.json({ settings: merged, users, email_identities })
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
  // Default email sending identity — validated to this company (null if invalid).
  if ('default_email_identity_id' in body) {
    const raw = typeof body.default_email_identity_id === 'string' && body.default_email_identity_id
      ? body.default_email_identity_id
      : null
    update.default_email_identity_id = raw ? await validIdentityId(admin, access.companyId, raw) : null
  }
  if ('rvm_enabled' in body) update.rvm_enabled = body.rvm_enabled === true
  if ('rvm_consent_confirmed' in body) update.rvm_consent_confirmed = body.rvm_consent_confirmed === true

  const { error } = await admin.from('drip_settings').upsert(update, { onConflict: 'company_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // rvm_caller_id lives on drip_settings; text_autonomy (Amber autonomy) lives on
  // voice_receptionist_settings where Amber reads it. Written best-effort via `as any`
  // (additive columns not in lib/database.types.ts yet). TODO regen types.
  if ('rvm_caller_id' in body) {
    const val = typeof body.rvm_caller_id === 'string' ? body.rvm_caller_id.trim() || null : null
    await (admin as any).from('drip_settings').update({ rvm_caller_id: val }).eq('company_id', access.companyId)
  }
  if ('text_autonomy' in body) {
    const val = body.text_autonomy === 'auto' ? 'auto' : 'draft'
    await (admin as any).from('voice_receptionist_settings').update({ text_autonomy: val }).eq('company_id', access.companyId)
  }

  return NextResponse.json({ ok: true })
}
