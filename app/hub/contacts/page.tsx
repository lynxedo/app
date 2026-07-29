import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ContactsPanel from './ContactsPanel'

export default async function ContactsIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_hub')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_hub) redirect('/hub')

  // Initial server fetch — tags + the first page of contacts with embedded
  // tags. Client takes over for search/filter/CRUD + infinite scroll.
  const [tagsRes, contactsRes] = await Promise.all([
    supabase
      .from('contact_tags')
      .select('id, label, color, sort_order')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true }),
    supabase
      .from('txt_contacts')
      .select(`
        id, name, first_name, last_name, company_name, is_company,
        phone, email, email_status, do_not_text, notes, jobber_client_id, sources,
        address_line1, address_line2, city, state, postal_code, country,
        tags:contact_tag_assignments(tag_id, contact_tags(id, label, color))
      `)
      .is('deleted_at', null)
      .eq('in_directory', true)
      .is('archived_at', null)  // archived contacts are hidden from the default list
      // Match the client's first page exactly (order + size) so the handoff
      // to client-side infinite scroll is seamless — no flash of different rows.
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(0, 99),
  ])

  type RawTag = { tag_id: string; contact_tags: { id: string; label: string; color: string } | { id: string; label: string; color: string }[] | null }
  type RawContact = {
    id: string; name: string; first_name: string | null; last_name: string | null
    company_name: string | null; is_company: boolean
    phone: string; email: string | null; email_status: string
    do_not_text: boolean; notes: string | null; jobber_client_id: string | null; sources: string[]
    address_line1: string | null; address_line2: string | null; city: string | null
    state: string | null; postal_code: string | null; country: string | null
    tags: RawTag[]
  }

  const initialContacts = ((contactsRes.data ?? []) as unknown as RawContact[]).map(c => {
    const tags = (c.tags ?? []).flatMap(t => {
      const inner = Array.isArray(t.contact_tags) ? t.contact_tags : (t.contact_tags ? [t.contact_tags] : [])
      return inner
    })
    return { ...c, tags }
  })

  return (
    <ContactsPanel
      initialContacts={initialContacts}
      initialTags={tagsRes.data ?? []}
    />
  )
}
