import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Master PRD Session 10 — per-company inventory settings: which location route
// spraying decrements from + the low-stock alert recipients. Mirrors fleet-settings.

async function requireAdmin() {
  const check = await requireAdminArea('products')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

export async function GET() {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('inventory_settings')
    .select('*')
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

const UUID_RE = /^[0-9a-f-]{36}$/i

function sanitizeUuidArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const v of raw) if (typeof v === 'string' && UUID_RE.test(v)) out.push(v)
  return [...new Set(out)]
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = { company_id: ctx.companyId, updated_at: new Date().toISOString() }

  if ('deduct_location_id' in body) {
    const v = body.deduct_location_id
    if (v === null || v === '') patch.deduct_location_id = null
    else if (typeof v === 'string' && UUID_RE.test(v)) patch.deduct_location_id = v
    else return NextResponse.json({ error: 'deduct_location_id must be a uuid or null' }, { status: 400 })
  }
  if ('low_stock_alerts_enabled' in body) {
    if (typeof body.low_stock_alerts_enabled !== 'boolean') {
      return NextResponse.json({ error: 'low_stock_alerts_enabled must be boolean' }, { status: 400 })
    }
    patch.low_stock_alerts_enabled = body.low_stock_alerts_enabled
  }
  for (const k of ['alert_recipient_user_ids', 'alert_recipient_room_ids'] as const) {
    if (k in body) {
      const arr = sanitizeUuidArray(body[k])
      if (arr === null) return NextResponse.json({ error: `${k} must be an array of uuid strings` }, { status: 400 })
      patch[k] = arr
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('inventory_settings')
    .upsert(patch, { onConflict: 'company_id' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
