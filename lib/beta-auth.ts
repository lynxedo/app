// Access checks for the beta routes. Two levels:
//  • requireBetaAccess — a user may USE beta features (admin OR the
//    can_access_beta grant from Admin → People). Gates opt-in + feedback.
//  • requireBetaAdmin — a user may MANAGE the beta registry (super-admin only,
//    same bar as Scoreboards admin). Gates the Admin → Beta CRUD routes.
// Mirrors lib/email-auth.ts.
import { createClient } from '@/lib/supabase/server'

export type BetaAccess =
  | { ok: true; userId: string; companyId: string }
  | { ok: false; status: 401 | 403 }

export async function requireBetaAccess(): Promise<BetaAccess> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401 }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_beta, role')
    .eq('id', user.id)
    .maybeSingle()

  const canAccess = profile?.role === 'admin' || profile?.can_access_beta === true
  if (!canAccess || !profile?.company_id) return { ok: false, status: 403 }

  return { ok: true, userId: user.id, companyId: profile.company_id }
}

export async function requireBetaAdmin(): Promise<BetaAccess> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401 }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin' || !profile?.company_id) return { ok: false, status: 403 }
  return { ok: true, userId: user.id, companyId: profile.company_id }
}
