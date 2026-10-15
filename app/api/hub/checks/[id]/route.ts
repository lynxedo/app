import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canManageChecks } from '@/lib/check-deposit'

// PATCH /api/hub/checks/:id  { status: 'deposited' | 'pending' | 'void' }
//
// Checks-room members + admins only — the people who deposit. 'pending' is the
// undo for a mis-tap; 'void' is a check that will never be deposited (bounced,
// handed back, a duplicate photo).

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const auth = await requireCompany({ grant: 'can_access_hub' })
  if ('error' in auth) return auth.error
  const admin = createAdminClient()

  if (!(await canManageChecks(admin, auth.companyId, auth.userId, auth.role))) {
    return NextResponse.json({ error: 'Only the people in the checks room can change this.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { status?: unknown } | null
  const status = body?.status
  if (status !== 'deposited' && status !== 'pending' && status !== 'void') {
    return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('check_deposits')
    .update(status === 'deposited'
      ? { status, deposited_at: new Date().toISOString(), deposited_by: auth.userId }
      : { status, deposited_at: null, deposited_by: null })
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
