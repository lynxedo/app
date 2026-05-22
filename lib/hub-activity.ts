import { createAdminClient } from '@/lib/supabase/admin'

// Bumps hub_users.last_active_at = now() for a user.
// Best-effort, non-blocking — callers do not await this. Errors are swallowed.
// Used by the salaried/unlinked-user presence path: anyone whose pay_type is not
// 'hourly' (or who has no employees row) shows 🟢 when last_active_at is within
// the last 2 hours, otherwise ⚫.
export function markActive(userId: string): void {
  if (!userId) return
  const admin = createAdminClient()
  admin
    .from('hub_users')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', userId)
    .then(() => undefined, () => undefined)
}
