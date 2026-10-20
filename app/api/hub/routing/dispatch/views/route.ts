import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeViewConfig } from '@/lib/dispatch'

// Dispatch saved views (Ben, Oct 20 2026): team + filters + Day/Week/Month + a
// date rule under a name. Yours by default; `shared` shows it to the whole
// company. Only the person who made a view can change or delete it.

const SELECT = 'id, user_id, name, config, shared, updated_at'

export async function GET() {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const admin = createAdminClient()
  const { data, error } = await admin.from('dispatch_views').select(SELECT)
    .eq('company_id', auth.companyId)
    .or(`user_id.eq.${auth.userId},shared.eq.true`)
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    views: (data ?? []).map(v => ({ ...v, config: normalizeViewConfig(v.config), mine: v.user_id === auth.userId })),
  })
}

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const b = await request.json().catch(() => null) as { name?: string; config?: unknown; shared?: boolean } | null
  const name = (b?.name ?? '').trim().slice(0, 60)
  if (!name) return NextResponse.json({ error: 'Give the view a name' }, { status: 400 })
  const admin = createAdminClient()
  const { data, error } = await admin.from('dispatch_views').insert({
    company_id: auth.companyId, user_id: auth.userId, name, config: normalizeViewConfig(b?.config), shared: b?.shared === true,
  }).select(SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ view: { ...data, config: normalizeViewConfig(data.config), mine: true } })
}

export async function PUT(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const b = await request.json().catch(() => null) as { id?: string; name?: string; config?: unknown; shared?: boolean } | null
  if (!b?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 60)
  if (b.config !== undefined) patch.config = normalizeViewConfig(b.config)
  if (typeof b.shared === 'boolean') patch.shared = b.shared
  const admin = createAdminClient()
  const { data, error } = await admin.from('dispatch_views').update(patch)
    .eq('id', b.id).eq('company_id', auth.companyId).eq('user_id', auth.userId)
    .select(SELECT).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Only the person who made this view can change it' }, { status: 403 })
  return NextResponse.json({ view: { ...data, config: normalizeViewConfig(data.config), mine: true } })
}

export async function DELETE(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient()
  const { data, error } = await admin.from('dispatch_views').delete()
    .eq('id', id).eq('company_id', auth.companyId).eq('user_id', auth.userId).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Only the person who made this view can delete it' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
