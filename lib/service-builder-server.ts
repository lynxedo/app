// lib/service-builder-server.ts
// Server-only helpers for the Service Builder admin API + page (Master PRD Session 4).
// Reuses the Products permission gate (can_admin_products) — the Builder sits beside
// the Products screen and reads the same catalog.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdminArea } from '@/lib/admin-auth'
import type { BuilderRound, BuilderSettings, ChartStatus } from '@/lib/service-builder'

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
// seeded product_rounds (so a new version can pre-fill its rounds).
export async function loadServiceBuilderData(admin: SupabaseClient, companyId: string) {
  const [charts, products, rounds] = await Promise.all([
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
      .from('product_rounds')
      .select('id, program, round_label, product_ids')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('program', { ascending: true })
      .order('round_label', { ascending: true }),
  ])
  return {
    charts: charts.data ?? [],
    products: products.data ?? [],
    rounds: rounds.data ?? [],
    error: charts.error || products.error || rounds.error || null,
  }
}
