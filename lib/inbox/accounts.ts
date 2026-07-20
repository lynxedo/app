// inbox_accounts resolution helpers. inbox_accounts is service-role-only, so callers pass the admin client.

import type { SupabaseClient } from '@supabase/supabase-js'

export type InboxAccount = {
  id: string
  company_id: string
  provider: string
  underlying_provider: string | null
  nylas_grant_id: string | null
  account_type: 'shared' | 'personal'
  email_address: string
  display_name: string | null
  owner_user_id: string | null
  sync_cursor: string | null
  last_synced_at: string | null
  last_error: string | null
  status: string
  active: boolean
}

// Fields safe to expose to the client (never the grant id).
export type SafeInboxAccount = {
  id: string
  provider: string
  account_type: 'shared' | 'personal'
  email_address: string
  display_name: string | null
  owner_user_id: string | null
  status: string
  active: boolean
}

const ACCOUNT_COLS =
  'id, company_id, provider, underlying_provider, nylas_grant_id, account_type, email_address, display_name, owner_user_id, sync_cursor, last_synced_at, last_error, status, active'

export function toSafeAccount(a: InboxAccount): SafeInboxAccount {
  return {
    id: a.id,
    provider: a.provider,
    account_type: a.account_type,
    email_address: a.email_address,
    display_name: a.display_name,
    owner_user_id: a.owner_user_id,
    status: a.status,
    active: a.active,
  }
}

export async function getInboxAccountById(admin: SupabaseClient, id: string): Promise<InboxAccount | null> {
  const { data } = await admin.from('inbox_accounts').select(ACCOUNT_COLS).eq('id', id).maybeSingle()
  return (data as InboxAccount) || null
}

export async function getSharedAccount(admin: SupabaseClient, companyId: string): Promise<InboxAccount | null> {
  const { data } = await admin
    .from('inbox_accounts')
    .select(ACCOUNT_COLS)
    .eq('company_id', companyId)
    .eq('account_type', 'shared')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as InboxAccount) || null
}

export async function getPersonalAccount(
  admin: SupabaseClient,
  companyId: string,
  userId: string
): Promise<InboxAccount | null> {
  const { data } = await admin
    .from('inbox_accounts')
    .select(ACCOUNT_COLS)
    .eq('company_id', companyId)
    .eq('account_type', 'personal')
    .eq('owner_user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as InboxAccount) || null
}

// Every mailbox this user may act on: the shared account (only if full access) + their own personal account.
export async function listAccessibleAccounts(
  admin: SupabaseClient,
  companyId: string,
  userId: string,
  fullAccess: boolean
): Promise<InboxAccount[]> {
  const out: InboxAccount[] = []
  if (fullAccess) {
    const shared = await getSharedAccount(admin, companyId)
    if (shared) out.push(shared)
  }
  const personal = await getPersonalAccount(admin, companyId, userId)
  if (personal) out.push(personal)
  return out
}
