import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// GET /api/hub/email/company-settings — the company default signature template.
// Readable by anyone who can enter the inbox (so the composer/settings can show it).
export async function GET() {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId } = auth
  const admin = createAdminClient()
  const { data } = await admin
    .from('inbox_settings')
    .select('default_signature')
    .eq('company_id', companyId)
    .maybeSingle()
  return NextResponse.json({ defaultSignature: (data?.default_signature as string | null) || '' })
}

// PUT /api/hub/email/company-settings { defaultSignature } — managers/admins only.
export async function PUT(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const admin = createAdminClient()
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const tpl = typeof body.defaultSignature === 'string' ? body.defaultSignature : ''
  const { error } = await admin.from('inbox_settings').upsert(
    { company_id: companyId, default_signature: tpl.trim() || null, updated_at: new Date().toISOString() },
    { onConflict: 'company_id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
