import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TXT_BROADCASTS_ENABLED } from '@/lib/txt-features'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// GET  /api/txt/broadcasts        — list recent broadcasts for the company
// POST /api/txt/broadcasts        — create + enqueue recipients

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('txt_broadcasts')
    .select(
      `id, body, status, recipient_count, sent_count, failed_count, skipped_count,
       created_by, created_at, started_at, completed_at, last_error, apply_signature,
       creator:hub_users!created_by ( id, display_name )`
    )
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ broadcasts: data ?? [] })
}

// POST body: { body: string, contact_ids: string[], apply_signature?: boolean }
//
// Creates a broadcast row with status='queued' and one txt_broadcast_recipients
// row per requested contact (do-not-text contacts are inserted as status='skipped'
// up front so the broadcast totals stay honest). The actual sending is drained
// by the /api/txt/broadcasts/process cron endpoint.
export async function POST(request: Request) {
  // Broadcasts are currently disabled (see lib/txt-features.ts).
  if (!TXT_BROADCASTS_ENABLED) {
    return NextResponse.json(
      { error: 'Broadcasts are currently turned off.' },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const text: string = (body.body || '').trim()
  const contactIds: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : []
  const applySignature: boolean = body.apply_signature === true

  if (!text) return NextResponse.json({ error: 'Body required' }, { status: 400 })
  if (contactIds.length === 0) {
    return NextResponse.json({ error: 'Pick at least one contact' }, { status: 400 })
  }

  // Manager-only: broadcasts can hit hundreds of customers; not a one-tap action.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_txt, can_assign_txt_threads')
    .eq('id', user.id)
    .single()
  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true
  if (!isManager) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Validate contacts belong to this company; bucket them up front so the
  // recipient rows pre-classify do-not-text as 'skipped'.
  const { data: contacts, error: cErr } = await admin
    .from('txt_contacts')
    .select('id, do_not_text')
    .eq('company_id', HEROES_COMPANY_ID)
    .in('id', contactIds)
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ error: 'No valid contacts' }, { status: 400 })
  }

  const sendable = contacts.filter((c) => !c.do_not_text)
  const blocked = contacts.filter((c) => c.do_not_text)

  const { data: broadcast, error: bErr } = await admin
    .from('txt_broadcasts')
    .insert({
      company_id: HEROES_COMPANY_ID,
      created_by: user.id,
      body: text,
      apply_signature: applySignature,
      status: 'queued',
      recipient_count: contacts.length,
      skipped_count: blocked.length,
    })
    .select('id')
    .single()
  if (bErr || !broadcast) {
    return NextResponse.json({ error: bErr?.message || 'Insert failed' }, { status: 500 })
  }

  const rows = [
    ...sendable.map((c) => ({
      broadcast_id: broadcast.id,
      contact_id: c.id,
      status: 'queued' as const,
    })),
    ...blocked.map((c) => ({
      broadcast_id: broadcast.id,
      contact_id: c.id,
      status: 'skipped' as const,
      error_message: 'do_not_text',
      processed_at: new Date().toISOString(),
    })),
  ]
  const { error: rErr } = await admin.from('txt_broadcast_recipients').insert(rows)
  if (rErr) {
    // Roll back the broadcast row so we don't leave a phantom queued one.
    await admin.from('txt_broadcasts').delete().eq('id', broadcast.id)
    return NextResponse.json({ error: rErr.message }, { status: 500 })
  }

  return NextResponse.json({
    broadcast_id: broadcast.id,
    queued: sendable.length,
    skipped: blocked.length,
  })
}
