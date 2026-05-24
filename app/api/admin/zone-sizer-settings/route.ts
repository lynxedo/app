import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const check = await requireAdminArea('zone_sizer')
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
    .from('zone_sizer_settings')
    .select('*')
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

const ALLOWED_FIELDS = ['turf_sqft_per_zone', 'bed_sqft_per_zone'] as const

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ALLOWED_FIELDS) {
    if (k in body) {
      const raw = body[k]
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: `${k} must be a positive integer` }, { status: 400 })
      }
      patch[k] = n
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zone_sizer_settings')
    .upsert({ company_id: ctx.companyId, ...patch }, { onConflict: 'company_id' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
