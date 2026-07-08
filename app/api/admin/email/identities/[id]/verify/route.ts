import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { getDomainStatus, resendConfigured } from '@/lib/resend'

// Re-check ONE identity's Resend domain verification and store the result on
// email_sending_identities.domain_verified. Driven by the admin panel's
// per-identity "Refresh status" button.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params

  if (!resendConfigured()) {
    return NextResponse.json({ error: 'Resend is not configured yet (RESEND_API_KEY missing).' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: identity } = await admin
    .from('email_sending_identities')
    .select('resend_domain_id')
    .eq('company_id', check.company_id)
    .eq('id', id)
    .maybeSingle()
  if (!identity) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!identity.resend_domain_id) {
    return NextResponse.json({ error: 'No Resend domain id saved on this identity. Add it first, then refresh.' }, { status: 400 })
  }

  const status = await getDomainStatus(identity.resend_domain_id)
  if (!status.ok) return NextResponse.json({ error: status.error }, { status: 502 })

  const verified = status.status === 'verified'
  await admin
    .from('email_sending_identities')
    .update({ domain_verified: verified, updated_at: new Date().toISOString() })
    .eq('company_id', check.company_id)
    .eq('id', id)

  return NextResponse.json({ status: status.status, domain_verified: verified })
}
