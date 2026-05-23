import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ActivityFeed from './ActivityFeed'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-white">Activity</h1>
          <p className="text-sm text-gray-400 mt-1">
            @mentions and replies to your threads. Last 30 days.
          </p>
        </header>
        <ActivityFeed />
      </div>
    </div>
  )
}
