import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TxtContactsView from '@/components/hub/txt/TxtContactsView'

export default async function TxtContactsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <TxtContactsView />
}
