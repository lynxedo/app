import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxAccountById, getSharedAccount } from '@/lib/inbox/accounts'
import { nylasRevokeGrant } from '@/lib/inbox/nylas'

export const dynamic = 'force-dynamic'

// POST /api/auth/nylas/disconnect { account_id }
// Revokes the Nylas grant and deletes the inbox_accounts row (cascade removes the
// mirrored threads/messages/folders/etc). Gate depends on the mailbox kind:
//   shared   → Integrations admin of the owning company
//   personal → the owning user only
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { account_id?: string } | null
  const accountId = body?.account_id

  const admin = createAdminClient()
  let account
  if (accountId) {
    account = await getInboxAccountById(admin, accountId)
  } else {
    // Integrations-card path: the generic Disconnect button POSTs no body → resolve
    // the caller's shared mailbox (integrations admin only).
    const check = await requireAdminArea('integrations')
    if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    account = await getSharedAccount(admin, check.company_id)
  }
  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (account.account_type === 'shared') {
    const check = await requireAdminArea('integrations')
    if (!check.ok || check.company_id !== account.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    const auth = await requireCompany()
    if ('error' in auth) return auth.error
    if (auth.companyId !== account.company_id || auth.userId !== account.owner_user_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Best-effort revoke at Nylas (nylasRevokeGrant already swallows its own errors).
  if (account.nylas_grant_id) await nylasRevokeGrant(account.nylas_grant_id)

  const { error } = await admin.from('inbox_accounts').delete().eq('id', account.id)
  if (error) {
    console.error('[nylas:disconnect] delete failed:', error.message)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
