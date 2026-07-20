import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { listTenants, getBillingMode } from '@/lib/billing/catalog'

// Platform super-admin tenant console (cross-company). Lists every tenant with a
// compact billing snapshot for the current env's billing mode. Service-role admin
// client — this reads across all companies, which RLS would otherwise scope out.

export async function GET() {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const admin = createAdminClient()
  try {
    const tenants = await listTenants(admin, getBillingMode())
    return NextResponse.json({ tenants })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
