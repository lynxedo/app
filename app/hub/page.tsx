import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/supabase/current-user'
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

  // A long-idle phone lands on the day's work rather than the home screen — the
  // same rule HubIdleTracker applies once you are inside. Request-cached, so this
  // costs nothing on top of the layout's own read.
  const profile = await getCurrentProfile()

  if (!first) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No rooms available. Ask an admin to create one.</p>
      </div>
    )
  }

  return (
    <HubRootRedirect
      fallback={`/hub/${first.id}`}
      canAccessDailyLog={profile?.can_access_daily_log_v2 ?? false}
    />
  )
}
