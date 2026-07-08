import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function clean(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

async function loadOwned(admin: ReturnType<typeof createAdminClient>, companyId: string, id: string) {
  const { data } = await admin
    .from('email_sending_identities')
    .select('id, resend_domain_id, is_default')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  return data
}

// PUT — edit an identity's fields and/or make it the company default.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id || !check.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const existing = await loadOwned(admin, check.company_id, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: check.user.id }

  if ('from_email' in body) {
    const v = clean(body.from_email)
    if (!v || !emailRe.test(v)) return NextResponse.json({ error: 'A valid From address is required.' }, { status: 400 })
    patch.from_email = v
  }
  if ('reply_to' in body) {
    const v = clean(body.reply_to)
    if (v && !emailRe.test(v)) return NextResponse.json({ error: 'Reply-To is not a valid email address.' }, { status: 400 })
    patch.reply_to = v
  }
  if ('label' in body) patch.label = clean(body.label) || (patch.from_email as string) || undefined
  if ('from_name' in body) patch.from_name = clean(body.from_name)
  if ('sending_domain' in body) patch.sending_domain = clean(body.sending_domain)?.toLowerCase() ?? null
  if ('resend_domain_id' in body) {
    const v = clean(body.resend_domain_id)
    patch.resend_domain_id = v
    // Pointing at a different Resend domain invalidates the prior verification —
    // require a fresh "Refresh status" check before it's trusted again.
    if (v !== existing.resend_domain_id) patch.domain_verified = false
  }

  // Make default: clear others first (the partial unique index allows only one).
  if (body.is_default === true) {
    await admin.from('email_sending_identities')
      .update({ is_default: false })
      .eq('company_id', check.company_id)
      .neq('id', id)
    patch.is_default = true
  }

  const { error } = await admin
    .from('email_sending_identities')
    .update(patch)
    .eq('company_id', check.company_id)
    .eq('id', id)
  if (error) {
    const msg = /duplicate key|unique/i.test(error.message)
      ? 'An identity with that From address already exists.'
      : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE — remove an identity. Campaigns/automations that referenced it fall back
// to the company default (FK is ON DELETE SET NULL). If the default is removed,
// the oldest remaining identity is promoted so the company always has one.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const existing = await loadOwned(admin, check.company_id, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.from('email_sending_identities').delete().eq('company_id', check.company_id).eq('id', id)

  if (existing.is_default) {
    const { data: next } = await admin
      .from('email_sending_identities')
      .select('id')
      .eq('company_id', check.company_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (next) {
      await admin.from('email_sending_identities').update({ is_default: true }).eq('id', next.id)
    }
  }
  return NextResponse.json({ deleted: true })
}
