import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('marketing')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof body.active === 'boolean') updates.active = body.active
  if (typeof body.account_name === 'string' && body.account_name.trim()) {
    updates.account_name = body.account_name.trim()
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('social_accounts')
    .update(updates)
    .eq('id', id)
    .eq('company_id', check.company_id)
    .select('id, platform, account_name, external_id, ig_user_id, active, token_expires_at, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ account: data })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('marketing')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const { error } = await admin
    .from('social_accounts')
    .delete()
    .eq('id', id)
    .eq('company_id', check.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
