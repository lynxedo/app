import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FormFillView from './FormFillView'
import type { Form } from '@/lib/forms'

export const metadata = { title: 'Fill Form' }

export default async function FormFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_forms')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_forms) redirect('/hub')

  const { data: form } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('company_id', profile.company_id!)
    .eq('active', true)
    .single()

  if (!form) notFound()

  const { data: hubUser } = await supabase
    .from('hub_users')
    .select('display_name')
    .eq('id', user.id)
    .single()

  return (
    <FormFillView
      form={form as Form}
      userId={user.id}
      techName={hubUser?.display_name ?? 'Unknown Tech'}
    />
  )
}
