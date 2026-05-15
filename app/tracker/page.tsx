import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TrackerPage from './TrackerPage'

export default async function TrackerRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: settings } = await supabase
    .from('tracker_settings')
    .select('*')
    .single()

  const currentUser = {
    email: user.email ?? '',
    name: user.email?.split('@')[0] ?? 'Unknown',
    isAdmin: profile?.role === 'admin',
  }

  return <TrackerPage settings={settings} currentUser={currentUser} />
}
