import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const check = await requireAdminArea('daily_log')
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
    .from('daily_log_settings')
    .select('*')
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
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

  const raw = body.completion_notify_user_ids
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { error: 'completion_notify_user_ids must be an array' },
      { status: 400 },
    )
  }
  const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))]

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('daily_log_settings')
    .upsert(
      {
        company_id: ctx.companyId,
        completion_notify_user_ids: ids,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    )
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
