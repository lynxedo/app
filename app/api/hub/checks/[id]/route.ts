import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canManageChecks } from '@/lib/check-deposit'

// PATCH /api/hub/checks/:id  { status: 'deposited' | 'pending' | 'void' }
//                            { posted: true | false }
//
// Checks-room members + admins only — the people who post and deposit.
// 'pending' is the undo for a mis-tap; 'void' is a check that will never be
// deposited (bounced, handed back, a duplicate photo). posted = the payment has
// been applied to the customer's account in Jobber (Kathryn), independent of
// deposited (Zac) — either can happen first.

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const auth = await requireCompany({ grant: 'can_access_hub' })
  if ('error' in auth) return auth.error
  const admin = createAdminClient()

  if (!(await canManageChecks(admin, auth.companyId, auth.userId, auth.role))) {
    return NextResponse.json({ error: 'Only the people in the checks room can change this.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { status?: unknown; posted?: unknown } | null
  let patch: Record<string, unknown>
  if (typeof body?.posted === 'boolean') {
    patch = body.posted
      ? { posted_at: new Date().toISOString(), posted_by: auth.userId }
      : { posted_at: null, posted_by: null }
  } else {
    const status = body?.status
    if (status !== 'deposited' && status !== 'pending' && status !== 'void') {
      return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
    }
    patch = status === 'deposited'
      ? { status, deposited_at: new Date().toISOString(), deposited_by: auth.userId }
      : { status, deposited_at: null, deposited_by: null }
  }

  const { data, error } = await admin
    .from('check_deposits')
    .update(patch)
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
