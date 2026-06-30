import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MyTasksView from '@/components/hub/MyTasksView'

export default async function MyTasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <MyTasksView />
}
