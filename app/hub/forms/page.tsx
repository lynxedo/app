import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FormsView from './FormsView'
import type { Form } from '@/lib/forms'

export const metadata = { title: 'Forms' }

export default async function FormsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_forms, can_admin_forms, role')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_forms) redirect('/hub')

  const { data: forms } = await supabase
    .from('forms')
    .select('id, name, description, fields, active, created_at')
    .eq('active', true)
    .order('created_at', { ascending: true })

  const canAdmin = profile.role === 'admin' || !!profile.can_admin_forms

  return <FormsView initialForms={(forms ?? []) as Form[]} canAdmin={canAdmin} />
}
