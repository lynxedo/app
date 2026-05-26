import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ContactsAdminPanel from './ContactsAdminPanel'

export default async function ContactsAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_contacts, can_admin_hub, company_id')
    .eq('id', user.id)
    .single()

  const isAdmin =
    profile?.role === 'admin' ||
    !!profile?.can_admin_contacts ||
    !!profile?.can_admin_hub
  if (!isAdmin) redirect('/hub/admin')

  const admin = createAdminClient()

  // Initial tags + per-tag assignment counts
  const { data: tags } = await admin
    .from('contact_tags')
    .select('id, label, color, sort_order, created_at')
    .eq('company_id', profile?.company_id || '')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  const tagIds = (tags ?? []).map(t => t.id)
  const counts: Record<string, number> = {}
  if (tagIds.length > 0) {
    const { data: assigns } = await admin
      .from('contact_tag_assignments')
      .select('tag_id')
      .in('tag_id', tagIds)
    for (const a of assigns ?? []) counts[a.tag_id] = (counts[a.tag_id] || 0) + 1
  }

  const initialTags = (tags ?? []).map(t => ({ ...t, count: counts[t.id] || 0 }))

  return <ContactsAdminPanel initialTags={initialTags} />
}
