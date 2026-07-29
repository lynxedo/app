// lib/service-builder-server.ts
// Server-only helpers for the Service Builder admin API + page (Master PRD Session 4).
// Reuses the Products permission gate (can_admin_products) — the Builder sits beside
// the Products screen and reads the same catalog.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdminArea } from '@/lib/admin-auth'
import type { BuilderRound, BuilderSettings, ChartStatus, PriceTier, PricingUnit } from '@/lib/service-builder'
import { deriveRoundsFromMappings, naturalCompare, type SeededRound } from '@/lib/service-mapping'

const STATUSES: ChartStatus[] = ['draft', 'published', 'archived']

// Validate the editable fields of a program version. `partial` = PATCH (only touch
// supplied keys); otherwise every numeric/text field is read with sane fallbacks.
export function parseChartBody(
  body: Record<string, unknown>,
  partial: boolean,
): Record<string, unknown> | { error: string } {
  const out: Record<string, unknown> = {}
  const setStr = (key: string, max: number, required = false) => {
    if (!(key in body)) { if (!partial && required) return `${key} is required`; return null }
    const v = body[key]
    if (v === null || v === undefined || v === '') { out[key] = required ? '' : null; if (required && out[key] === '') return `${key} is required`; return null }
    if (typeof v !== 'string') return `${key} must be a string`
    if (v.length > max) return `${key} is too long`
    out[key] = v.trim()
    return null
  }
  const setNum = (key: string) => {
    if (!(key in body)) return null
    const v = body[key]
    if (v === null || v === undefined || v === '') { out[key] = null; return null }
    const n = typeof v === 'number' ? v : Number(v)
    if (!isFinite(n)) return `${key} must be a number`
    out[key] = n
    return null
  }

  for (const e of [
    setStr('name', 200, !partial),
    setStr('program_key', 80, !partial),
    setStr('version_label', 80),
    setStr('description', 2000),
  ]) if (e) return { error: e }

  for (const key of ['visits', 'base_fee', 'price_per_k', 'labor_rate', 'min_low', 'min_high', 'threshold']) {
    const e = setNum(key); if (e) return { error: e }
  }

  if ('status' in body) {
    const s = body.status
    if (typeof s !== 'string' || !STATUSES.includes(s as ChartStatus)) return { error: 'invalid status' }
    out.status = s
    out.is_published = s === 'published'
  }

  if ('effective_from' in body) {
    const v = body.effective_from
    if (v === null || v === undefined || v === '') out.effective_from = null
    else if (typeof v === 'string') out.effective_from = v
    else return { error: 'effective_from invalid' }
  }

  if ('rounds' in body) {
    const r = body.rounds
    if (!Array.isArray(r)) return { error: 'rounds must be an array' }
    const rounds: BuilderRound[] = []
    for (const row of r) {
      if (typeof row !== 'object' || row === null) return { error: 'invalid round' }
      const rr = row as Record<string, unknown>
      const ids = Array.isArray(rr.product_ids) ? rr.product_ids.filter((x) => typeof x === 'string') as string[] : []
      rounds.push({ id: typeof rr.id === 'string' ? rr.id : Math.random().toString(36).slice(2, 9), name: typeof rr.name === 'string' ? rr.name : 'Round', product_ids: ids })
    }
    out.rounds = rounds
  }

  if ('builder_settings' in body) {
    const bs = body.builder_settings
    if (bs !== null && typeof bs !== 'object') return { error: 'builder_settings invalid' }
    out.builder_settings = bs as BuilderSettings | null
  }

  if ('pricing_unit' in body) {
    const u = body.pricing_unit
    if (u === null || u === undefined || u === '') out.pricing_unit = null
    else if (u === 'sqft_k' || u === 'zones') out.pricing_unit = u as PricingUnit
    else return { error: 'invalid pricing_unit' }
  }

  if ('tiers' in body) {
    const t = body.tiers
    if (t === null) { out.tiers = null }
    else if (!Array.isArray(t)) return { error: 'tiers must be an array' }
    else {
      const tiers: PriceTier[] = []
      for (const row of t) {
        if (typeof row !== 'object' || row === null) return { error: 'invalid tier' }
        const rr = row as Record<string, unknown>
        const up = rr.up_to
        const up_to = up === null || up === undefined || up === '' ? null
          : (isFinite(Number(up)) ? Number(up) : NaN)
        if (Number.isNaN(up_to)) return { error: 'tier up_to must be a number or blank' }
        const base_fee = isFinite(Number(rr.base_fee)) ? Number(rr.base_fee) : 0
        const price_per_unit = isFinite(Number(rr.price_per_unit)) ? Number(rr.price_per_unit) : 0
        tiers.push({ up_to, base_fee, price_per_unit })
      }
      // Keep bands in ascending order; the open-ended (null) band sorts last.
      tiers.sort((a, b) => (a.up_to == null ? 1 : b.up_to == null ? -1 : a.up_to - b.up_to))
      out.tiers = tiers.length ? tiers : null
    }
  }

  return out
}

export async function gateServiceBuilder(): Promise<{ companyId: string } | { error: NextResponse }> {
  const check = await requireAdminArea('products')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

// One round-trip for the whole Builder screen: the price charts (program versions),
// the live product catalog (read-only here — edited on the Products screen), and the
// per-program rounds (so a new version can pre-fill its rounds). Rounds are derived
// from Service Mapping's dated batches (2026-07-09 redesign); programs that have no
// mapping batches yet fall back to the legacy product_rounds table.
export async function loadServiceBuilderData(admin: SupabaseClient, companyId: string) {
  const [charts, products, mappingRows, legacyRounds] = await Promise.all([
    admin
      .from('program_price_charts')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('program_key', { ascending: true })
      .order('created_at', { ascending: true }),
    admin
      .from('products')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    admin
      .from('service_products')
      .select('jobber_line_item_name, program, product_id, effective_start, effective_end, batch_label')
      .eq('company_id', companyId)
      .is('deleted_at', null),
    admin
      .from('product_rounds')
      .select('id, program, round_label, product_ids')
      .eq('company_id', companyId)
      .is('deleted_at', null),
  ])

  const derived = deriveRoundsFromMappings(mappingRows.data ?? [])
  const derivedPrograms = new Set(derived.map(r => r.program))
  const legacy = ((legacyRounds.data ?? []) as SeededRound[])
    .filter(r => r.program && !derivedPrograms.has(r.program))
    .sort((a, b) => naturalCompare(a.program, b.program) || naturalCompare(a.round_label ?? '', b.round_label ?? ''))

  return {
    charts: charts.data ?? [],
    products: products.data ?? [],
    rounds: [...derived, ...legacy],
    error: charts.error || products.error || mappingRows.error || legacyRounds.error || null,
  }
}
