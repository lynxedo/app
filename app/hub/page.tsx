import { createClient } from '@/lib/supabase/server'
import HubRootRedirect from '@/components/hub/HubRootRedirect'

export default async function HubPage() {
  const supabase = await createClient()

  // Fallback target if the user has no saved last route — prefer #general,
  // otherwise the first room they belong to.
  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, name')
    .is('archived_at', null)
    .order('name')
    .limit(10)

  const general = rooms?.find(r => r.name === 'general')
  const first = general ?? rooms?.[0]

  if (!first) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No rooms available. Ask an admin to create one.</p>
      </div>
    )
  }

  return <HubRootRedirect fallback={`/hub/${first.id}`} />
}
