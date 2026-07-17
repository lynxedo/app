import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// Revoke an inbound Hub automation key. Gated to match the Admin → Integrations
// page that hosts the UI: super-admin OR the can_admin_integrations grant.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const check = await requireAdminArea('integrations')
  if (!check.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('hub_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', check.company_id)
    .is('revoked_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
