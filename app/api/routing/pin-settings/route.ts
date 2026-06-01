import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EMPTY_PIN_SETTINGS, sanitizePinSettings } from '@/lib/pin-colors'

// Company-scoped pin color settings for the Advanced Route Planner.
//   GET  — any signed-in company member (RLS allows company members to SELECT)
//   POST — admins only (role === 'admin' OR can_admin_routing); written via the
//          service-role admin client because the table's write RLS is role==='admin'
//          only, while routing admin is also granted via can_admin_routing.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: hu } = await supabase
    .from('hub_users').select('company_id').eq('id', user.id).maybeSingle()
  if (!hu?.company_id) return NextResponse.json({ pin_settings: EMPTY_PIN_SETTINGS })

  const { data, error } = await supabase
    .from('company_routing_settings').select('pin_settings')
    .eq('company_id', hu.company_id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ pin_settings: sanitizePinSettings(data?.pin_settings) })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: profile }, { data: hu }] = await Promise.all([
    supabase.from('user_profiles').select('role, can_admin_routing').eq('id', user.id).maybeSingle(),
    supabase.from('hub_users').select('company_id').eq('id', user.id).maybeSingle(),
  ])
  const isAdmin = profile?.role === 'admin' || profile?.can_admin_routing === true
  if (!isAdmin || !hu?.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const clean = sanitizePinSettings((body as { pin_settings?: unknown })?.pin_settings)

  const admin = createAdminClient()
  const { error } = await admin
    .from('company_routing_settings')
    .upsert(
      { company_id: hu.company_id, pin_settings: clean, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: 'company_id' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ pin_settings: clean })
}
