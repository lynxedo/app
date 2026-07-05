// lib/route-capacity-server.ts
// Server-only helpers for Session 7 (Route Capacity).
//   • Part A tank-config admin gates on `can_admin_routing` (it lives in
//     Admin → Routing, beside pin colors + depot).
//   • The capacity-data + tank-assignment endpoints used by Advanced Routing are
//     for any routing user — they read with the user session client (RLS
//     company-scopes via get_my_company_id()) and write with the service role
//     (these tables have no write policy), mirroring /api/hub/routing/batches.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireAdminArea } from '@/lib/admin-auth'

// Gate for Part A (tank config CRUD).
export async function gateTankAdmin(): Promise<{ companyId: string } | { error: NextResponse }> {
  const check = await requireAdminArea('routing')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

// Gate for the routing-user endpoints (capacity-data, tank-assignments):
// requires the same can_access_routing flag that gates the Routing nav/page
// (flag-only, no admin bypass — mirrors app/hub/layout.tsx). Returns the
// company_id for write scoping.
export async function gateRoutingUser(): Promise<{ companyId: string; userId: string } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_routing')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'No company' }, { status: 403 }) }
  if (!profile.can_access_routing) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { companyId: profile.company_id, userId: user.id }
}

// Validate a tank_configs body. `partial` = PATCH.
export function parseTankBody(
  body: Record<string, unknown>,
  partial: boolean,
): Record<string, unknown> | { error: string } {
  const out: Record<string, unknown> = {}

  if ('tank_number' in body || !partial) {
    const v = body.tank_number
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isInteger(n) || n < 1 || n > 4) return { error: 'tank_number must be 1–4' }
    out.tank_number = n
  }

  if ('label' in body) {
    const v = body.label
    if (v === null || v === undefined || v === '') out.label = null
    else if (typeof v === 'string') out.label = v.trim().slice(0, 120)
    else return { error: 'label must be a string' }
  }

  if ('gallon_capacity' in body) {
    const v = body.gallon_capacity
    if (v === null || v === undefined || v === '') out.gallon_capacity = null
    else { const n = typeof v === 'number' ? v : Number(v); if (!isFinite(n) || n < 0) return { error: 'gallon_capacity must be a positive number' }; out.gallon_capacity = n }
  }

  if ('application_rate' in body || !partial) {
    const v = body.application_rate
    if (v === null || v === undefined || v === '') {
      if (!partial) out.application_rate = 2 // sensible default = Heroes' 2 gal/K
    } else {
      const n = typeof v === 'number' ? v : Number(v)
      if (!isFinite(n) || n <= 0) return { error: 'application_rate must be greater than 0' }
      out.application_rate = n
    }
  }

  if ('is_active' in body) out.is_active = !!body.is_active

  if (!partial && Object.keys(out).length === 0) return { error: 'Nothing to create' }
  return out
}

// The bundle Advanced Routing needs to compute a loadout client-side.
export async function loadCapacityData(supabase: SupabaseClient, companyId: string) {
  const [tanks, serviceProducts, products] = await Promise.all([
    supabase.from('tank_configs').select('id, tank_number, label, gallon_capacity, application_rate, is_active').eq('company_id', companyId).order('tank_number', { ascending: true }),
    supabase.from('service_products').select('id, jobber_line_item_name, match_type, product_id, application_rate, rate_unit, program, tank_default, effective_start, effective_end, batch_label, is_active').eq('company_id', companyId).is('deleted_at', null),
    supabase.from('products').select('id, name, unit, application_rate, rate_basis').eq('company_id', companyId).is('deleted_at', null),
  ])
  return {
    tanks: tanks.data ?? [],
    serviceProducts: serviceProducts.data ?? [],
    products: products.data ?? [],
    error: tanks.error || serviceProducts.error || products.error || null,
  }
}
