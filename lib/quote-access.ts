import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Work Orders & Quotes PRD — Phase 4 (Quotes). The one access rule for every
// quote page and API (the Oct 5 2026 audit: middleware gates pages only, every
// handler checks its own grant).
//   canUse   — build + send quotes: can_access_quotes (techs and the office —
//              Ben, Oct 5 2026: "everyone may send quotes") or admin.
//   canAdmin — templates, terms, the reviews list: can_admin_quotes or admin.

export function quoteAccess(p: { role?: string | null; can_access_quotes?: boolean | null; can_admin_quotes?: boolean | null } | null | undefined): { canUse: boolean; canAdmin: boolean } {
  const isAdmin = p?.role === 'admin'
  const canAdmin = isAdmin || p?.can_admin_quotes === true
  return { canUse: canAdmin || p?.can_access_quotes === true, canAdmin }
}

export type QuoteCaller = { userId: string; companyId: string; canUse: boolean; canAdmin: boolean }

/** Resolve the caller; `need` = 'use' (build/send) or 'admin' (templates, reviews). */
export async function resolveQuoteCaller(need: 'use' | 'admin'): Promise<QuoteCaller | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_quotes, can_admin_quotes')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const a = quoteAccess(profile)
  if (need === 'admin' ? !a.canAdmin : !a.canUse) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { userId: user.id, companyId: profile.company_id as string, ...a }
}
