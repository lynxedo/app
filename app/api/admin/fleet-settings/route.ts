import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const check = await requireAdminArea('fleet')
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
    .from('fleet_settings')
    .select('*')
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

const ALLOWED_FIELDS = [
  'alert_speeding',
  'alert_after_hours',
  'alert_low_fuel',
  'alert_offline',
  'speed_threshold_mph',
  'fuel_threshold_pct',
  'offline_timeout_min',
  'work_hours_start',
  'work_hours_end',
  'work_tz',
  'alert_recipient_user_ids',
  'alert_recipient_room_ids',
] as const

function sanitizeUuidArray(raw: unknown): string[] | null {
  if (raw === undefined) return null
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const v of raw) {
    if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) out.push(v)
  }
  return [...new Set(out)]
}

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
    if (!(k in body)) continue
    if (k === 'alert_recipient_user_ids' || k === 'alert_recipient_room_ids') {
      const arr = sanitizeUuidArray(body[k])
      if (arr === null) {
        return NextResponse.json(
          { error: `${k} must be an array of uuid strings` },
          { status: 400 },
        )
      }
      patch[k] = arr
    } else {
      patch[k] = body[k]
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('fleet_settings')
    .upsert({ company_id: ctx.companyId, ...patch }, { onConflict: 'company_id' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
