import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

const ALLOWED_TIERS = ['basic', 'manager', 'full'] as const

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('guardian')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Tier is a privileged grant — only super-admins write. Matches the pattern
  // for role and can_admin_* fields in /api/admin/users/[id].
  if (!check.isSuperAdmin) {
    return NextResponse.json(
      { error: 'Only full admins can change Guardian tiers' },
      { status: 403 }
    )
  }

  const { id: userId } = await params

  let body: { guardian_tier?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const next = body.guardian_tier
  if (typeof next !== 'string' || !ALLOWED_TIERS.includes(next as typeof ALLOWED_TIERS[number])) {
    return NextResponse.json(
      { error: `guardian_tier must be one of: ${ALLOWED_TIERS.join(', ')}` },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Verify target user belongs to the caller's company.
  const { data: target } = await admin
    .from('user_profiles')
    .select('id, company_id')
    .eq('id', userId)
    .maybeSingle()

  if (!target || (target as { company_id: string }).company_id !== check.company_id) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('user_profiles')
    .update({ guardian_tier: next, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id, guardian_tier')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}
