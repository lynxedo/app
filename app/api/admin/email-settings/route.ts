import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

const DB_SELECT =
  'company_id, from_name, from_email, reply_to, sending_domain, domain_verified, resend_domain_id, physical_address, updated_at'

export async function GET() {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_settings').select(DB_SELECT)
    .eq('company_id', check.company_id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ settings: data ?? { company_id: check.company_id } })
}

type PutBody = Partial<{
  from_name: string | null
  from_email: string | null
  reply_to: string | null
  sending_domain: string | null
  resend_domain_id: string | null
  physical_address: string | null
}>

function cleanEmail(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

export async function PUT(req: NextRequest) {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id || !check.user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: PutBody
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Light validation: From / Reply-To must look like an address if provided.
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
  for (const key of ['from_email', 'reply_to'] as const) {
    if (key in body) {
      const v = cleanEmail(body[key])
      if (v && !emailRe.test(v)) {
        return NextResponse.json({ error: `${key} is not a valid email address` }, { status: 400 })
      }
    }
  }

  const patch: Record<string, unknown> = {
    company_id: check.company_id,
    updated_at: new Date().toISOString(),
    updated_by: check.user.id,
  }
  if ('from_name' in body)        patch.from_name        = typeof body.from_name === 'string' ? (body.from_name.trim() || null) : null
  if ('from_email' in body)       patch.from_email       = cleanEmail(body.from_email)
  if ('reply_to' in body)         patch.reply_to         = cleanEmail(body.reply_to)
  if ('sending_domain' in body)   patch.sending_domain   = typeof body.sending_domain === 'string' ? (body.sending_domain.trim().toLowerCase() || null) : null
  if ('resend_domain_id' in body) patch.resend_domain_id = typeof body.resend_domain_id === 'string' ? (body.resend_domain_id.trim() || null) : null
  if ('physical_address' in body) patch.physical_address = typeof body.physical_address === 'string' ? (body.physical_address.trim() || null) : null

  const admin = createAdminClient()
  const { error } = await admin.from('email_settings').upsert(patch, { onConflict: 'company_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: fresh } = await admin
    .from('email_settings').select(DB_SELECT)
    .eq('company_id', check.company_id).maybeSingle()
  return NextResponse.json({ settings: fresh })
}
