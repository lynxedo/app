// Shared access check for the Drip Marketing builder routes (campaigns, steps,
// enrollments, settings). Anyone with can_manage_drip may build/edit; admins
// always. Mirrors lib/email-auth.ts. The engine itself (lib/drip.ts) runs under
// the service role via the cron; this only gates the builder UI + its API.
import { createClient } from '@/lib/supabase/server'

export type DripAccess =
  | { ok: true; userId: string; companyId: string }
  | { ok: false; status: 401 | 403 }

export async function requireDripAccess(): Promise<DripAccess> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401 }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_manage_drip, role')
    .eq('id', user.id)
    .maybeSingle()

  const canAccess = profile?.role === 'admin' || profile?.can_manage_drip === true
  if (!canAccess || !profile?.company_id) return { ok: false, status: 403 }

  return { ok: true, userId: user.id, companyId: profile.company_id }
}
