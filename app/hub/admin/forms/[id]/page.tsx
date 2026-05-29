import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import FormBuilder from './FormBuilder'
import type { Form } from '@/lib/forms'

export const metadata = { title: 'Form Builder' }

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_forms, company_id')
    .eq('id', user.id)
    .single()

  const allowed = profile?.role === 'admin' || !!profile?.can_admin_forms
  if (!allowed) redirect('/hub')

  const admin = createAdminClient()
  const { data: form } = await admin
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('company_id', profile.company_id!)
    .single()

  if (!form) notFound()

  return <FormBuilder initialForm={form as Form} />
}
