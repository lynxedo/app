import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HubPage() {
  const supabase = await createClient()

  // Redirect to the user's first room (prefer #general)
  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, name')
    .is('archived_at', null)
    .order('name')
    .limit(10)

  const general = rooms?.find(r => r.name === 'general')
  const first = general ?? rooms?.[0]

  if (first) {
    redirect(`/hub/${first.id}`)
  }

  return (
    <div className="flex-1 flex items-center justify-center text-gray-500">
      <p>No rooms available. Ask an admin to create one.</p>
    </div>
  )
}
