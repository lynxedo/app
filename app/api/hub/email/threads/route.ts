import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompany } from '@/lib/company-auth'
import { getInboxUserFlags } from '@/lib/inbox/permissions'
import { getSharedAccount, getPersonalAccount, getInboxAccountById } from '@/lib/inbox/accounts'
import { ilikeSearchPattern } from '@/lib/search'

export const dynamic = 'force-dynamic'

type Scope = 'mine' | 'all' | 'unassigned' | 'closed' | 'needs_reply'
const SCOPES: Scope[] = ['mine', 'all', 'unassigned', 'closed', 'needs_reply']

// Resolve display names (hub_users.display_name → user_profiles.full_name) for a
// set of user ids. inbox_threads.assigned_to_user_id references auth.users, which
// has no PostgREST FK to hub_users, so we map names in a separate admin lookup.
async function displayNamesFor(
  admin: ReturnType<typeof createAdminClient>,
  ids: (string | null | undefined)[]
): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  if (uniq.length === 0) return {}
  const [{ data: hus }, { data: profs }] = await Promise.all([
    admin.from('hub_users').select('id, display_name').in('id', uniq),
    admin.from('user_profiles').select('id, full_name').in('id', uniq),
  ])
  const map: Record<string, string> = {}
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) map[p.id] = p.full_name
  }
  for (const h of (hus ?? []) as { id: string; display_name: string | null }[]) {
    if (h.display_name) map[h.id] = h.display_name
  }
  return map
}

export async function GET(req: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId, supabase } = auth

  const url = new URL(req.url)
  const scopeParam = (url.searchParams.get('scope') || 'mine') as Scope
  const scope: Scope = SCOPES.includes(scopeParam) ? scopeParam : 'mine'
  const accountParam = url.searchParams.get('account') || 'shared'
  const folder = url.searchParams.get('folder')
  const search = (url.searchParams.get('search') || '').trim()
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100)
  const before = url.searchParams.get('before')

  const admin = createAdminClient()

  // Resolve the target mailbox. inbox_accounts is service-role only.
  let account
  if (accountParam === 'shared') {
    account = await getSharedAccount(admin, companyId)
  } else if (accountParam === 'personal') {
    account = await getPersonalAccount(admin, companyId, userId)
  } else {
    const byId = await getInboxAccountById(admin, accountParam)
    account = byId && byId.company_id === companyId ? byId : null
  }
  if (!account) return NextResponse.json({ threads: [] })

  const flags = await getInboxUserFlags(supabase, userId)
  const isPersonal = account.account_type === 'personal'

  // Queue scopes are shared-inbox-only, and unassigned/needs_reply are manager views.
  if (!isPersonal && (scope === 'unassigned' || scope === 'needs_reply') && !flags.isFullAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // My membership thread ids (shared account only) — used for the `mine` scope and
  // the per-row `mine` flag. RLS lets me read my own membership rows.
  let myThreadIds: string[] = []
  if (!isPersonal) {
    const { data: mem } = await supabase
      .from('inbox_thread_members')
      .select('thread_id')
      .eq('user_id', userId)
    myThreadIds = (mem ?? []).map((m) => (m as { thread_id: string }).thread_id)
  }

  // Reads go through the COOKIE client so the technician thread-scoped RLS applies.
  let q = supabase
    .from('inbox_threads')
    .select(
      'id, subject, snippet, last_message_at, last_message_direction, from_name, from_email, participants, assigned_to_user_id, status, is_shared, unread, folder, provider_folder_ids, has_attachments, contact_id'
    )
    .eq('account_id', account.id)

  if (isPersonal) {
    // Personal mailbox: ignore queue scopes; RLS already restricts to the owner.
  } else {
    switch (scope) {
      case 'mine': {
        q = q.neq('status', 'closed')
        if (myThreadIds.length > 0) {
          const idList = myThreadIds.map((id) => `"${id}"`).join(',')
          q = q.or(`assigned_to_user_id.eq.${userId},id.in.(${idList})`)
        } else {
          q = q.eq('assigned_to_user_id', userId)
        }
        break
      }
      case 'unassigned':
        q = q.eq('status', 'open').is('assigned_to_user_id', null)
        break
      case 'closed':
        q = q.eq('status', 'closed')
        break
      case 'needs_reply':
        q = q.neq('status', 'closed').eq('last_message_direction', 'inbound')
        break
      case 'all':
      default:
        q = q.neq('status', 'closed')
        break
    }
  }

  if (folder) q = q.contains('provider_folder_ids', [folder])

  if (search) {
    const pat = ilikeSearchPattern(search)
    q = q.or(`subject.ilike.${pat},snippet.ilike.${pat},from_email.ilike.${pat}`)
  }

  if (before) q = q.lt('last_message_at', before)

  q = q.order('last_message_at', { ascending: false, nullsFirst: false }).limit(limit)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const threads = (data ?? []) as Array<{
    id: string
    assigned_to_user_id: string | null
    [k: string]: unknown
  }>

  const names = await displayNamesFor(admin, threads.map((t) => t.assigned_to_user_id))
  const mySet = new Set(myThreadIds)

  const enriched = threads.map((t) => ({
    ...t,
    assignee_name: t.assigned_to_user_id ? names[t.assigned_to_user_id] || null : null,
    mine: isPersonal || t.assigned_to_user_id === userId || mySet.has(t.id),
  }))

  return NextResponse.json({ threads: enriched })
}
