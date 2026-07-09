// lib/service-mapping-server.ts
// Server-only helpers for the Service Mapping admin API + page (Master PRD
// Session 6). Reuses the Products permission gate (can_admin_products) — it sits
// beside Products + the Service Builder and reads the same catalog.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdminArea } from '@/lib/admin-auth'
import { MATCH_TYPES, type MatchType } from '@/lib/service-mapping'

export async function gateServiceMapping(): Promise<{ companyId: string } | { error: NextResponse }> {
  const check = await requireAdminArea('products')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

// One round-trip for the whole screen: the two mapping tables, the live product
// catalog (read-only here — edited on the Products screen), and the distinct
// Jobber line-item names for the autocomplete.
export async function loadServiceMappingData(admin: SupabaseClient, companyId: string) {
  const [serviceProducts, rounds, products, names] = await Promise.all([
    admin
      .from('service_products')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('jobber_line_item_name', { ascending: true })
      .order('created_at', { ascending: true }),
    admin
      .from('product_rounds')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('program', { ascending: true })
      .order('round_label', { ascending: true }),
    admin
      .from('products')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    admin.rpc('service_mapping_line_item_names', { p_company_id: companyId }),
  ])
  return {
    serviceProducts: serviceProducts.data ?? [],
    rounds: rounds.data ?? [],
    products: products.data ?? [],
    lineItemNames: names.data ?? [],
    error: serviceProducts.error || rounds.error || products.error || names.error || null,
  }
}

// Validate the editable fields of a service_products row. `partial` = PATCH.
export function parseServiceProductBody(
  body: Record<string, unknown>,
  partial: boolean,
): Record<string, unknown> | { error: string } {
  const out: Record<string, unknown> = {}

  if ('jobber_line_item_name' in body || !partial) {
    const v = body.jobber_line_item_name
    if (typeof v !== 'string' || !v.trim()) return { error: 'jobber_line_item_name is required' }
    if (v.length > 300) return { error: 'jobber_line_item_name is too long' }
    out.jobber_line_item_name = v.trim()
  }

  if ('match_type' in body) {
    const v = body.match_type
    if (typeof v !== 'string' || !MATCH_TYPES.includes(v as MatchType)) return { error: 'invalid match_type' }
    out.match_type = v
  }

  if ('product_id' in body) {
    const v = body.product_id
    if (v === null || v === undefined || v === '') out.product_id = null
    else if (typeof v === 'string') out.product_id = v
    else return { error: 'invalid product_id' }
  }

  for (const key of ['application_rate'] as const) {
    if (key in body) {
      const v = body[key]
      if (v === null || v === undefined || v === '') { out[key] = null }
      else { const n = typeof v === 'number' ? v : Number(v); if (!isFinite(n)) return { error: `${key} must be a number` }; out[key] = n }
    }
  }

  if ('tank_default' in body) {
    const v = body.tank_default
    if (v === null || v === undefined || v === '') out.tank_default = null
    else { const n = typeof v === 'number' ? v : Number(v); if (!Number.isInteger(n) || n < 1 || n > 4) return { error: 'tank_default must be 1–4' }; out.tank_default = n }
  }

  for (const key of ['rate_unit', 'program', 'notes', 'alt_group', 'batch_label'] as const) {
    if (key in body) {
      const v = body[key]
      if (v === null || v === undefined || v === '') out[key] = null
      else if (typeof v === 'string') out[key] = v.trim()
      else return { error: `${key} must be a string` }
    }
  }

  // Mix-batch date window — YYYY-MM-DD, or null = open-ended / always-on.
  for (const key of ['effective_start', 'effective_end'] as const) {
    if (key in body) {
      const v = body[key]
      if (v === null || v === undefined || v === '') out[key] = null
      else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) out[key] = v.trim()
      else return { error: `${key} must be a YYYY-MM-DD date` }
    }
  }

  if ('is_active' in body) out.is_active = !!body.is_active
  if ('show_on_mix_sheet' in body) out.show_on_mix_sheet = !!body.show_on_mix_sheet

  if (!partial && Object.keys(out).length === 0) return { error: 'Nothing to create' }
  return out
}

// (parseProductRoundBody was removed 2026-07-09 with the Current Rounds tab —
// product_rounds is now read-only legacy data, kept for the in-panel import
// and the Service Builder pre-fill fallback.)
