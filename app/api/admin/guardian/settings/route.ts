import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function requireGuardianAdmin() {
  const check = await requireAdminArea('guardian')
  if (!check.ok || !check.company_id || !check.user) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id, userId: check.user.id }
}

export async function GET() {
  const ctx = await requireGuardianAdmin()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('guardian_settings')
    .select('*')
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    settings: data ?? { company_id: ctx.companyId, model: 'claude-sonnet-4-6', web_search_daily_cap: 30 },
  })
}

export async function POST(request: Request) {
  const ctx = await requireGuardianAdmin()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {
    company_id: ctx.companyId,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  }

  if ('model' in body) {
    const m = typeof body.model === 'string' ? body.model.trim() : ''
    if (!m) return NextResponse.json({ error: 'Model must be a non-empty string' }, { status: 400 })
    if (m.length > 120) return NextResponse.json({ error: 'Model id too long' }, { status: 400 })
    patch.model = m
  }

  if ('web_search_daily_cap' in body) {
    const raw = body.web_search_daily_cap
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'web_search_daily_cap must be a non-negative integer' }, { status: 400 })
    }
    patch.web_search_daily_cap = n
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('guardian_settings')
    .upsert(patch, { onConflict: 'company_id' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort: bust the tools cache so a model change picks up the latest tool list.
  try {
    const { bustToolsCache } = await import('@/lib/hub-claude')
    bustToolsCache()
  } catch {
    // hub-claude may not export bustToolsCache yet on cold deploys — ignore.
  }

  return NextResponse.json({ settings: data })
}
