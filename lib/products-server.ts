// lib/products-server.ts
// Server-only helpers for the Products/Inventory admin API + page (Session 81).
// Gate, the combined data loader, and small request-parsing helpers shared by every
// /api/admin/products* route so each route file stays thin.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdminArea } from '@/lib/admin-auth'

export async function gateProducts(): Promise<{ companyId: string } | { error: NextResponse }> {
  const check = await requireAdminArea('products')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

// One round-trip for the whole admin grid: items (+ nested sub-items + per-location
// inventory), groups, and locations. Variants/inventory are sorted client-side.
export async function loadProductsData(admin: SupabaseClient, companyId: string) {
  const [products, categories, locations] = await Promise.all([
    admin
      .from('products')
      .select('*, product_variants(*), product_location_inventory(*)')
      .eq('company_id', companyId)
      .order('name', { ascending: true }),
    admin
      .from('product_categories')
      .select('*')
      .eq('company_id', companyId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    admin
      .from('inventory_locations')
      .select('*')
      .eq('company_id', companyId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])
  return {
    products: products.data ?? [],
    categories: categories.data ?? [],
    locations: locations.data ?? [],
    error: products.error || categories.error || locations.error || null,
  }
}

// ---- request parsing ----
export function isErr(v: unknown): v is { err: string } {
  return typeof v === 'object' && v !== null && 'err' in v
}

export function reqStr(v: unknown, min = 1, max = 200): string | { err: string } {
  if (typeof v !== 'string') return { err: 'is required' }
  const t = v.trim()
  if (t.length < min) return { err: `must be at least ${min} character(s)` }
  if (t.length > max) return { err: `is too long (max ${max})` }
  return t
}

export function strOrNull(v: unknown, max = 500): string | null | { err: string } {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return { err: 'must be a string' }
  const t = v.trim()
  if (!t) return null
  if (t.length > max) return { err: `is too long (max ${max})` }
  return t
}

export function numOrNull(v: unknown): number | null | { err: string } {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!isFinite(n)) return { err: 'must be a number' }
  return n
}

export function boolOr(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def
}

const RATE_BASES = ['per_1000sqft', 'per_gallon', 'per_tree', 'other']
export function rateBasisOr(v: unknown, def = 'per_1000sqft'): string | { err: string } {
  if (v === undefined || v === null || v === '') return def
  if (typeof v === 'string' && RATE_BASES.includes(v)) return v
  return { err: `must be one of ${RATE_BASES.join(', ')}` }
}
