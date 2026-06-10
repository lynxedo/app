import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HubAdminPanel from '../hub/HubAdminPanel'

export const metadata = { title: 'File Tags Admin' }

// File Tags configure the Files tool's tag catalog. They share the Hub admin
// permission and render as their own top-level admin page (no Hub tab bar).
// The panel self-loads the tag list from /api/admin/file-tags on mount.
export default async function AdminFileTagsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_hub')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_hub) redirect('/hub/home')

  return (
    <HubAdminPanel
      initialRooms={[]}
      hubUsers={[]}
      allowMemberRoomCreation={false}
      activeAnnouncements={[]}
      only="file-tags"
    />
  )
}
