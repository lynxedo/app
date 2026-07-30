import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'

// Platform super-admin: the Service Costs reference (every external service Lynxedo uses +
// its monthly/usage cost). Service-role admin client — platform_service_costs is RLS
// service-role only.

const EDITABLE = ['category', 'service', 'plan', 'monthly', 'usage', 'notes', 'sort_order', 'active']

// GET — the full list.
export async function GET() {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('platform_service_costs')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('service', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ services: data ?? [] })
}

// POST — add a service. Body may include any editable field; service defaults sensibly.
export async function POST(request: Request) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const admin = createAdminClient()
  const row: Record<string, unknown> = {}
  for (const k of EDITABLE) if (body && k in body) row[k] = (body as Record<string, unknown>)[k]
  if (typeof row.service !== 'string' || !(row.service as string).trim()) row.service = 'New service'
  if (typeof row.category !== 'string' || !(row.category as string).trim()) row.category = 'Other'
  const { data, error } = await admin.from('platform_service_costs').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ service: data })
}
