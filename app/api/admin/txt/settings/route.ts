import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/admin/txt/settings  — read company Txt settings (admin)
// POST /api/admin/txt/settings — save settings (admin)
// Gated via requireAdminArea('hub') — Txt is part of Hub.

export async function GET() {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = createAdminClient()
  const { data } = await admin
    .from('txt_settings')
    .select('on_my_way_template, responder_notify_user_ids')
    .eq('company_id', auth.company_id)
    .maybeSingle()
  return NextResponse.json({
    on_my_way_template: data?.on_my_way_template ?? null,
    responder_notify_user_ids: (data as { responder_notify_user_ids?: string[] } | null)?.responder_notify_user_ids ?? [],
  })
}

export async function POST(request: Request) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))

  const admin = createAdminClient()
  const upsertRow: Record<string, unknown> = {
    company_id: auth.company_id,
    updated_at: new Date().toISOString(),
  }

  // on_my_way_template
  if ('on_my_way_template' in body) {
    const raw = typeof body.on_my_way_template === 'string' ? body.on_my_way_template.trim() : ''
    if (raw.length > 1000) {
      return NextResponse.json({ error: 'Template too long (max 1000 characters)' }, { status: 400 })
    }
    upsertRow.on_my_way_template = raw || null
  }

  // responder_notify_user_ids
  if ('responder_notify_user_ids' in body) {
    const ids = body.responder_notify_user_ids
    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: 'responder_notify_user_ids must be an array' }, { status: 400 })
    }
    upsertRow.responder_notify_user_ids = ids
  }

  const { error } = await admin
    .from('txt_settings')
    .upsert(upsertRow, { onConflict: 'company_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
