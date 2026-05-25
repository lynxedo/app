import { redirect } from 'next/navigation'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import TxtAdminShell from './TxtAdminShell'

export default async function TxtAdminPage() {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    redirect('/hub/home')
  }

  const admin = createAdminClient()

  const [{ data: templates }, { data: numbers }] = await Promise.all([
    admin
      .from('txt_templates')
      .select('id, scope, title, body, sort_order, owner_user_id, updated_at')
      .eq('company_id', auth.company_id)
      .eq('scope', 'org')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
    admin
      .from('txt_phone_numbers')
      .select('id, twilio_number, label, is_default, created_at')
      .eq('company_id', auth.company_id)
      .order('is_default', { ascending: false })
      .order('label', { ascending: true }),
  ])

  return (
    <TxtAdminShell
      initialTemplates={templates || []}
      initialNumbers={numbers || []}
    />
  )
}
