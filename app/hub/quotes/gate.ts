import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { quoteAccess } from '@/lib/quote-access'

/** Page gate for /hub/quotes/* — anyone who can build quotes (the APIs check again). */
export async function requireQuotePage(): Promise<{ canAdmin: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_quotes, can_admin_quotes')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) redirect('/dashboard')
  const a = quoteAccess(profile)
  if (!a.canUse) redirect('/hub')
  return { canAdmin: a.canAdmin }
}
