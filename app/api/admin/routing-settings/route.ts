import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { geocodeAddress } from '@/lib/geocode'
import type { DurationRulesConfig } from '@/app/api/settings/types'
import { DEFAULT_DURATION_RULES } from '@/app/api/settings/types'

const DEFAULTS = {
  display_name:            null as string | null,
  depot_address:           null as string | null,
  depot_lat:               null as number | null,
  depot_lng:               null as number | null,
  default_service_minutes: 30,
  default_drive_mph:       25,
  duration_method:         'default' as string,
  duration_rules:          DEFAULT_DURATION_RULES as DurationRulesConfig,
}

const DB_SELECT = 'display_name, depot_address, depot_lat, depot_lng, default_service_minutes, default_drive_mph, duration_method, duration_rules'

function mergeRules(raw: unknown): DurationRulesConfig {
  return { ...DEFAULT_DURATION_RULES, ...((raw as Partial<DurationRulesConfig>) ?? {}) }
}

async function getAdminCompanyId(userId: string) {
  const supabase = await createClient()
  const [{ data: profile }, { data: hu }] = await Promise.all([
    supabase.from('user_profiles').select('role, can_admin_routing').eq('id', userId).maybeSingle(),
    supabase.from('hub_users').select('company_id').eq('id', userId).maybeSingle(),
  ])
  const ok = profile?.role === 'admin' || profile?.can_admin_routing === true
  if (!ok || !hu?.company_id) return null
  return hu.company_id as string
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = await getAdminCompanyId(user.id)
  if (!companyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('company_routing_settings').select(DB_SELECT)
    .eq('company_id', companyId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    settings: { ...DEFAULTS, ...(data ?? {}), duration_rules: mergeRules(data?.duration_rules) },
  })
}

type PatchBody = Partial<{
  display_name: string | null
  depot_address: string | null
  default_service_minutes: number
  default_drive_mph: number
  duration_method: string
  duration_rules: DurationRulesConfig
}>

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = await getAdminCompanyId(user.id)
  if (!companyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: PatchBody
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.default_service_minutes !== undefined) {
    const v = body.default_service_minutes
    if (!Number.isFinite(v) || v < 5 || v > 180)
      return NextResponse.json({ error: 'default_service_minutes must be 5–180' }, { status: 400 })
  }
  if (body.default_drive_mph !== undefined) {
    const v = body.default_drive_mph
    if (!Number.isFinite(v) || v < 10 || v > 70)
      return NextResponse.json({ error: 'default_drive_mph must be 10–70' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { company_id: companyId, updated_at: new Date().toISOString(), updated_by: user.id }
  if ('display_name' in body)            patch.display_name            = body.display_name?.trim() || null
  if ('default_service_minutes' in body) patch.default_service_minutes = body.default_service_minutes
  if ('default_drive_mph' in body)       patch.default_drive_mph       = body.default_drive_mph
  if ('duration_method' in body)         patch.duration_method         = body.duration_method
  if ('duration_rules' in body)          patch.duration_rules          = body.duration_rules

  let geocodeFailed = false
  if ('depot_address' in body) {
    const addr = body.depot_address?.trim() || null
    patch.depot_address = addr
    if (addr) {
      const coord = await geocodeAddress(addr)
      if (!coord) { geocodeFailed = true }
      else { patch.depot_lat = coord.lat; patch.depot_lng = coord.lng }
    } else { patch.depot_lat = null; patch.depot_lng = null }
  }

  if (geocodeFailed)
    return NextResponse.json({ error: 'Could not geocode that address. Try adding city/state/zip.' }, { status: 422 })

  const { error } = await supabase
    .from('company_routing_settings')
    .upsert(patch, { onConflict: 'company_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: fresh } = await supabase
    .from('company_routing_settings').select(DB_SELECT)
    .eq('company_id', companyId).maybeSingle()

  return NextResponse.json({
    settings: { ...DEFAULTS, ...(fresh ?? {}), duration_rules: mergeRules(fresh?.duration_rules) },
  })
}
