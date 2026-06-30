// lib/mix-sheet-server.ts
// Server-only helpers for the Technician Mix Sheet (Phase B). Pilot gate reuses
// the Products grant (can_admin_products) — it reads the same catalog + the dated
// mixes from Service Mapping. The grid is derived live from service_products via
// selectMappingsForDate; only the per-month config (notes / granular / program
// selection) is persisted in mix_sheets.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdminArea } from '@/lib/admin-auth'
import { selectMappingsForDate } from '@/lib/service-mapping'
import {
  buildMixColumns, programsPresent, periodKeyFor, DEFAULT_TANK_RATE,
  type MixMappingInput, type MixProductInput, type MixColumn, type MixSheetConfig,
} from '@/lib/mix-sheet'

export async function gateMixSheet(): Promise<{ companyId: string } | { error: NextResponse }> {
  const check = await requireAdminArea('products')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

export type MixSheetPayload = {
  asOf: string
  tankRate: number
  columns: MixColumn[]
  programs: { key: string; abbr: string; name: string }[]
  config: MixSheetConfig
}

type DatedSpRow = MixMappingInput & {
  effective_start: string | null
  effective_end: string | null
  batch_label: string | null
}

// Everything the sheet needs for one `asOf` date (YYYY-MM-DD): the live columns,
// the programs present (for the picker), the tank ratio, and the saved per-month
// config (or sensible defaults when none exists yet).
export async function loadMixSheet(admin: SupabaseClient, companyId: string, asOf: string): Promise<MixSheetPayload> {
  const [sp, prod, tanks, cfg] = await Promise.all([
    admin.from('service_products')
      .select('id, jobber_line_item_name, product_id, application_rate, rate_unit, program, alt_group, effective_start, effective_end, batch_label')
      .eq('company_id', companyId).eq('is_active', true).is('deleted_at', null),
    admin.from('products')
      .select('id, name, unit, application_rate, rate_basis')
      .eq('company_id', companyId).is('deleted_at', null),
    admin.from('tank_configs')
      .select('application_rate, tank_number')
      .eq('company_id', companyId).eq('is_active', true).order('tank_number', { ascending: true }),
    admin.from('mix_sheets')
      .select('period_key, label, selected_programs, notes, granular_options')
      .eq('company_id', companyId).eq('period_key', periodKeyFor(asOf)).maybeSingle(),
  ])

  const tankRows = (tanks.data ?? []) as { application_rate: number | null }[]
  const tankRate = (tankRows[0]?.application_rate) || DEFAULT_TANK_RATE
  const rows = (sp.data ?? []) as unknown as DatedSpRow[]
  const active = selectMappingsForDate(rows, asOf)
  const productsById = new Map<string, MixProductInput>(((prod.data ?? []) as MixProductInput[]).map(p => [p.id, p]))
  const columns = buildMixColumns(active, productsById, tankRate)
  const programs = programsPresent(columns).map(p => ({ key: p.key, abbr: p.abbr, name: p.name }))

  const c = cfg.data as Partial<MixSheetConfig> | null
  const config: MixSheetConfig = {
    period_key: periodKeyFor(asOf),
    label: c?.label ?? null,
    selected_programs: c?.selected_programs ?? null,
    notes: c?.notes ?? null,
    granular_options: c?.granular_options ?? null,
  }

  return { asOf, tankRate, columns, programs, config }
}

// Validate the editable per-month config (PATCH/POST upsert).
export function parseMixSheetConfigBody(body: Record<string, unknown>): Record<string, unknown> | { error: string } {
  if (typeof body.period_key !== 'string' || !/^\d{4}-\d{2}$/.test(body.period_key)) {
    return { error: 'period_key (YYYY-MM) is required' }
  }
  const out: Record<string, unknown> = { period_key: body.period_key }
  if ('label' in body) out.label = body.label == null || body.label === '' ? null : String(body.label).slice(0, 120)
  if ('notes' in body) out.notes = body.notes == null ? null : String(body.notes).slice(0, 5000)
  if ('granular_options' in body) out.granular_options = body.granular_options == null ? null : String(body.granular_options).slice(0, 5000)
  if ('selected_programs' in body) {
    const v = body.selected_programs
    if (v == null) out.selected_programs = null
    else if (Array.isArray(v)) out.selected_programs = v.filter(x => typeof x === 'string')
    else return { error: 'selected_programs must be an array' }
  }
  return out
}
