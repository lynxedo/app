import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { listSendingIdentities } from '@/lib/email-identities'

// Admin management of a company's sending identities (Admin → Email Marketing).
// Verification status is set by the [id]/verify route; is_default by PUT.
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function clean(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

// GET — all identities for the company (verified or not).
export async function GET() {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const identities = await listSendingIdentities(admin, check.company_id)
  return NextResponse.json({ identities })
}

// POST — create a new sending identity. The first identity for a company becomes
// the default automatically; otherwise it's added non-default (switch via PUT).
export async function POST(req: NextRequest) {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id || !check.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const fromEmail = clean(body.from_email)
  if (!fromEmail || !emailRe.test(fromEmail)) {
    return NextResponse.json({ error: 'A valid From address is required.' }, { status: 400 })
  }
  const replyTo = clean(body.reply_to)
  if (replyTo && !emailRe.test(replyTo)) {
    return NextResponse.json({ error: 'Reply-To is not a valid email address.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const existing = await listSendingIdentities(admin, check.company_id)
  const label = clean(body.label) || fromEmail

  const { data, error } = await admin
    .from('email_sending_identities')
    .insert({
      company_id: check.company_id,
      label,
      from_name: clean(body.from_name),
      from_email: fromEmail,
      reply_to: replyTo,
      sending_domain: clean(body.sending_domain)?.toLowerCase() ?? null,
      resend_domain_id: clean(body.resend_domain_id),
      is_default: existing.length === 0, // first identity is the default
      updated_by: check.user.id,
    })
    .select('id')
    .single()

  if (error) {
    const msg = /duplicate key|unique/i.test(error.message)
      ? 'An identity with that From address already exists.'
      : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ id: data.id })
}
