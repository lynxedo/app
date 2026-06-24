// Shared access check for the Email Marketing builder routes (templates, segments,
// preview, tags). Anyone with can_access_email may build/edit content; admins
// always. The sending IDENTITY (domain/From) is separately admin-only via
// requireAdminArea('email') — that stays in the /api/admin/email-settings routes.
import { createClient } from '@/lib/supabase/server'

export type EmailAccess =
  | { ok: true; userId: string; companyId: string }
  | { ok: false; status: 401 | 403 }

export async function requireEmailAccess(): Promise<EmailAccess> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401 }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_email, role')
    .eq('id', user.id)
    .maybeSingle()

  const canAccess = profile?.role === 'admin' || profile?.can_access_email === true
  if (!canAccess || !profile?.company_id) return { ok: false, status: 403 }

  return { ok: true, userId: user.id, companyId: profile.company_id }
}
