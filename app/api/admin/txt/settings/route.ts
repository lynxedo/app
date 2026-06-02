import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/admin/txt/settings  — read company Txt settings (admin)
// POST /api/admin/txt/settings — save the On-My-Way template (admin)
// Gated via requireAdminArea('hub') — Txt is part of Hub.

export async function GET() {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()
  const { data } = await admin
    .from('txt_settings')
    .select('on_my_way_template')
    .eq('company_id', auth.company_id)
    .maybeSingle()
  return NextResponse.json({ on_my_way_template: data?.on_my_way_template ?? null })
}

export async function POST(request: Request) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const raw = typeof body.on_my_way_template === 'string' ? body.on_my_way_template.trim() : ''
  if (raw.length > 1000) {
    return NextResponse.json({ error: 'Template too long (max 1000 characters)' }, { status: 400 })
  }
  const template = raw || null

  const admin = createAdminClient()
  const { error } = await admin
    .from('txt_settings')
    .upsert(
      {
        company_id: auth.company_id,
        on_my_way_template: template,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, on_my_way_template: template })
}
