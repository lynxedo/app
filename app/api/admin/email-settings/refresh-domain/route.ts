import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { getDomainStatus, resendConfigured } from '@/lib/resend'

// Re-check the company's Resend domain verification status and store it on
// email_settings.domain_verified. Driven by the admin panel's "Refresh" button.
export async function POST() {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!resendConfigured()) {
    return NextResponse.json({ error: 'Resend is not configured yet (RESEND_API_KEY missing).' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('email_settings').select('resend_domain_id')
    .eq('company_id', check.company_id).maybeSingle()

  if (!settings?.resend_domain_id) {
    return NextResponse.json({ error: 'No Resend domain id saved. Add it first, then refresh.' }, { status: 400 })
  }

  const status = await getDomainStatus(settings.resend_domain_id)
  if (!status.ok) return NextResponse.json({ error: status.error }, { status: 502 })

  const verified = status.status === 'verified'
  await admin
    .from('email_settings')
    .update({ domain_verified: verified, updated_at: new Date().toISOString() })
    .eq('company_id', check.company_id)

  return NextResponse.json({ status: status.status, domain_verified: verified })
}
