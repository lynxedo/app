import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' || !profile.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: profile.company_id }
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const admin = createAdminClient()

  const { data: existing, error: fetchErr } = await admin
    .from('external_links')
    .select('id, company_id')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 })
  }
  if (existing.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const n = body.name.trim()
    if (!n) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    updates.name = n
  }
  if (typeof body.url === 'string') {
    const u = body.url.trim()
    if (!u || !isValidUrl(u)) {
      return NextResponse.json({ error: 'url must be a valid http(s) URL' }, { status: 400 })
    }
    updates.url = u
  }
  if (typeof body.icon === 'string') {
    updates.icon = body.icon.trim() || '🔗'
  }
  if (Number.isFinite(body.sort_order)) {
    updates.sort_order = Math.trunc(body.sort_order)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('external_links')
    .update(updates)
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .select('id, name, url, icon, sort_order, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const admin = createAdminClient()
  const { data: existing, error: fetchErr } = await admin
    .from('external_links')
    .select('id, company_id')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 })
  }
  if (existing.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await admin
    .from('external_links')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.companyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
