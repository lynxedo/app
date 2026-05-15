import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HubSidebar from '@/components/hub/HubSidebar'

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Load all rooms the user is a member of (public + private they belong to)
  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, name, is_private')
    .is('archived_at', null)
    .order('name')

  console.log('[hub layout] user:', user.id, 'rooms:', rooms?.length, 'error:', roomsError)

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <HubSidebar rooms={rooms ?? []} userEmail={user.email ?? ''} />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>
    </div>
  )
}
