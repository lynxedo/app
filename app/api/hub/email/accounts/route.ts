import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'
import { listAccessibleAccounts, toSafeAccount } from '@/lib/inbox/accounts'

export const dynamic = 'force-dynamic'

// GET /api/hub/email/accounts — the mailboxes this user may act on (the company's
// shared inbox if they have full access, plus their own personal mailbox) and their
// inbox permission flags. Never exposes the Nylas grant id (toSafeAccount strips it).
export async function GET() {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth

  // inbox_accounts is service-role-only; resolve with the admin client. Flags come
  // from user_profiles — read via admin for reliability regardless of RLS timing.
  const admin = createAdminClient()
  const flags = await getInboxUserFlags(admin, userId)
  const accounts = await listAccessibleAccounts(admin, companyId, userId, flags.isFullAccess)

  return NextResponse.json({
    accounts: accounts.map(toSafeAccount),
    flags: { isFullAccess: flags.isFullAccess, canCompose: flags.canCompose },
  })
}
