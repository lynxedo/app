import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FormsAdminPanel from './FormsAdminPanel'

export const metadata = { title: 'Form Builder — Admin' }

export default async function FormsAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_forms')
    .eq('id', user.id)
    .single()

  const allowed = profile?.role === 'admin' || !!profile?.can_admin_forms
  if (!allowed) redirect('/hub')

  return <FormsAdminPanel />
}
