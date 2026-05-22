import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

async function requireAdmin() {
  const check = await requireAdminArea('hub')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export async function GET() {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('external_links')
    .select('id, name, url, icon, sort_order, created_at')
    .eq('company_id', ctx.companyId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const body = await request.json().catch(() => ({}))
  const name: string = (body.name ?? '').trim()
  const url: string = (body.url ?? '').trim()
  const icon: string = (body.icon ?? '🔗').trim() || '🔗'
  const sortOrder: number = Number.isFinite(body.sort_order) ? Math.trunc(body.sort_order) : 0

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })
  if (!isValidUrl(url)) {
    return NextResponse.json({ error: 'url must be a valid http(s) URL' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('external_links')
    .insert({ company_id: ctx.companyId, name, url, icon, sort_order: sortOrder })
    .select('id, name, url, icon, sort_order, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data }, { status: 201 })
}
