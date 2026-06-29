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
    .select('on_my_way_template, responder_notify_user_ids, company_default_signature, allow_user_signatures, opt_out_message, opt_out_on_first_message')
    .eq('company_id', auth.company_id)
    .maybeSingle()
  const row = data as {
    responder_notify_user_ids?: string[]
    company_default_signature?: string | null
    allow_user_signatures?: boolean | null
    opt_out_message?: string | null
    opt_out_on_first_message?: boolean | null
  } | null
  return NextResponse.json({
    on_my_way_template: data?.on_my_way_template ?? null,
    responder_notify_user_ids: row?.responder_notify_user_ids ?? [],
    company_default_signature: row?.company_default_signature ?? null,
    allow_user_signatures: row?.allow_user_signatures ?? true,
    opt_out_message: row?.opt_out_message ?? 'Reply STOP to opt out.',
    opt_out_on_first_message: row?.opt_out_on_first_message ?? true,
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

  // company_default_signature — appended to outgoing texts when a user has no
  // personal signature (or when personal signatures are disabled).
  if ('company_default_signature' in body) {
    const raw = typeof body.company_default_signature === 'string' ? body.company_default_signature.trim() : ''
    if (raw.length > 500) {
      return NextResponse.json({ error: 'Signature too long (max 500 characters)' }, { status: 400 })
    }
    upsertRow.company_default_signature = raw || null
  }

  // allow_user_signatures — whether users may set their own signature.
  if ('allow_user_signatures' in body) {
    if (typeof body.allow_user_signatures !== 'boolean') {
      return NextResponse.json({ error: 'allow_user_signatures must be a boolean' }, { status: 400 })
    }
    upsertRow.allow_user_signatures = body.allow_user_signatures
  }

  // opt_out_message — the line appended to the FIRST text to a new contact.
  if ('opt_out_message' in body) {
    const raw = typeof body.opt_out_message === 'string' ? body.opt_out_message.trim() : ''
    if (raw.length > 200) {
      return NextResponse.json({ error: 'Opt-out message too long (max 200 characters)' }, { status: 400 })
    }
    upsertRow.opt_out_message = raw || 'Reply STOP to opt out.'
  }

  // opt_out_on_first_message — master on/off for the auto opt-out notice.
  if ('opt_out_on_first_message' in body) {
    if (typeof body.opt_out_on_first_message !== 'boolean') {
      return NextResponse.json({ error: 'opt_out_on_first_message must be a boolean' }, { status: 400 })
    }
    upsertRow.opt_out_on_first_message = body.opt_out_on_first_message
  }

  const { error } = await admin
    .from('txt_settings')
    .upsert(upsertRow, { onConflict: 'company_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
