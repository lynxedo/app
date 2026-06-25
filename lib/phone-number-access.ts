import type { SupabaseClient } from '@supabase/supabase-js'

// Per-user phone-number access scope (shared by Txt2 + Dialer).
//
// Restriction model: a user with NO rows in user_phone_number_access is
// UNRESTRICTED and sees every company number; a user WITH rows is limited to
// exactly those numbers. Managers/admins should bypass this at the call site
// (they always see all). The table is RLS-locked to service_role, so always
// read it through an admin/service client.

/**
 * Returns the phone_number_ids a user is restricted to, or `null` when the user
 * is unrestricted (no access rows → sees all numbers).
 */
export async function getAccessibleNumberIds(
  admin: SupabaseClient,
  userId: string
): Promise<string[] | null> {
  if (!userId) return null
  const { data } = await admin
    .from('user_phone_number_access')
    .select('phone_number_id')
    .eq('user_id', userId)
  if (!data || data.length === 0) return null
  return data.map((r) => r.phone_number_id as string)
}

/**
 * Convenience: does this user have access to a specific phone number?
 * Unrestricted users (null scope) always return true.
 */
export function canAccessNumber(
  scope: string[] | null,
  phoneNumberId: string | null | undefined
): boolean {
  if (scope === null) return true
  if (!phoneNumberId) return true // untagged conversations stay visible to everyone
  return scope.includes(phoneNumberId)
}
