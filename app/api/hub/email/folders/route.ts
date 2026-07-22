import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxAccountById, getPersonalAccount, getSharedAccount } from '@/lib/inbox/accounts'
import type { InboxAccount } from '@/lib/inbox/accounts'

export const dynamic = 'force-dynamic'

// GET /api/hub/email/folders?account=<accountId|shared|personal>
// Returns the mirrored folders for the requested mailbox. Folders are read through
// the cookie (RLS) client, so the shared/personal boundary is enforced by the
// inbox_folders policy — a technician can't read the shared mailbox's folders.
export async function GET(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId, supabase } = auth

  const { searchParams } = new URL(request.url)
  const accountParam = searchParams.get('account') || 'shared'

  // inbox_accounts is service-role-only → resolve the account row with admin.
  const admin = createAdminClient()
  let account: InboxAccount | null
  if (accountParam === 'shared') {
    account = await getSharedAccount(admin, companyId)
  } else if (accountParam === 'personal') {
    account = await getPersonalAccount(admin, companyId, userId)
  } else {
    account = await getInboxAccountById(admin, accountParam)
    // Never resolve an account from another tenant.
    if (account && account.company_id !== companyId) account = null
  }
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const { data: folders, error } = await supabase
    .from('inbox_folders')
    .select('id, provider_folder_id, name, parent_provider_folder_id, system_folder, unread_count, total_count')
    .eq('account_id', account.id)
    .eq('hidden', false) // admins can hide folders from the picker (still synced)
    .order('system_folder', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ folders: folders ?? [] })
}
