import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { logPlatformAction } from '@/lib/billing/audit'

// Platform super-admin action: suspend or re-activate a tenant company (cross-company).
// Flipping companies.is_active is the kill-switch for a whole tenant. Service-role admin
// client — writing across companies is outside any single tenant's RLS. The [id] path
// segment is the company_id.

// POST — body { active: boolean }. Sets companies.is_active and audits the change.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { active?: boolean } | null
  if (!body || typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'active (boolean) is required.' }, { status: 400 })
  }
  const active = body.active

  // Safety rail: never let a platform admin suspend their OWN company. is_active is the
  // whole-tenant kill-switch (enforced in a later track), so self-suspend would be a
  // self-lockout. Re-activating your own company is always allowed.
  if (!active && id === gate.companyId) {
    return NextResponse.json({ error: 'You cannot suspend your own company.' }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    const { error } = await admin.from('companies').update({ is_active: active }).eq('id', id)
    if (error) throw new Error(error.message)

    await logPlatformAction(admin, gate.userId, active ? 'activate_company' : 'suspend_company', id)

    return NextResponse.json({ ok: true, is_active: active })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
