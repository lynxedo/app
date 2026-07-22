import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'
import { getInboxAccountById, getPersonalAccount, getSharedAccount } from '@/lib/inbox/accounts'
import type { InboxAccount } from '@/lib/inbox/accounts'

export const dynamic = 'force-dynamic'

async function resolveAccount(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  userId: string,
  accountParam: string
): Promise<InboxAccount | null> {
  if (accountParam === 'shared') return getSharedAccount(admin, companyId)
  if (accountParam === 'personal') return getPersonalAccount(admin, companyId, userId)
  const byId = await getInboxAccountById(admin, accountParam)
  return byId && byId.company_id === companyId ? byId : null
}

// GET /api/hub/email/folders?account=<accountId|shared|personal>[&manage=1]
// Default: the visible folders for the picker (hidden ones filtered out). With
// manage=1 (managers only): ALL folders incl. hidden + the `hidden` flag, for the
// Folders admin panel. Read through the cookie (RLS) client so the shared/personal
// boundary is enforced by the inbox_folders policy.
export async function GET(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId, supabase } = auth

  const { searchParams } = new URL(request.url)
  const accountParam = searchParams.get('account') || 'shared'
  const manage = searchParams.get('manage') === '1'

  const admin = createAdminClient()
  const account = await resolveAccount(admin, companyId, userId, accountParam)
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  if (manage) {
    const flags = await getInboxUserFlags(admin, userId)
    if (!flags.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let q = supabase
    .from('inbox_folders')
    .select('id, provider_folder_id, name, parent_provider_folder_id, system_folder, unread_count, total_count, hidden')
    .eq('account_id', account.id)
    .order('system_folder', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
  if (!manage) q = q.eq('hidden', false) // admins can hide folders from the picker (still synced)

  const { data: folders, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ folders: folders ?? [] })
}

// PATCH /api/hub/email/folders — managers hide/show a folder in the picker.
// Body: { account, id, hidden }. The folder still syncs either way.
export async function PATCH(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth

  const body = await request.json().catch(() => ({}))
  const accountParam: string = typeof body.account === 'string' ? body.account : 'shared'
  const folderId: string = typeof body.id === 'string' ? body.id : ''
  const hidden = !!body.hidden
  if (!folderId) return NextResponse.json({ error: 'Missing folder id' }, { status: 400 })

  const admin = createAdminClient()
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const account = await resolveAccount(admin, companyId, userId, accountParam)
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const { error } = await admin
    .from('inbox_folders')
    .update({ hidden, updated_at: new Date().toISOString() })
    .eq('id', folderId)
    .eq('account_id', account.id) // scope to the resolved (company-owned) account
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
