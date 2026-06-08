import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Each entry is a "board" inside the Tracker section. Lead Tracker is the first
// live board; more boards (pulled from Monday.com) get added to this array.
type TrackerBoard = {
  id: string
  title: string
  description: string
  href: string
  icon: string
}

const BOARDS: TrackerBoard[] = [
  {
    id: 'leads',
    title: 'Lead Tracker',
    description: 'Sales pipeline — leads, stages, and conversions.',
    href: '/hub/tracker/leads',
    icon: '🎯',
  },
]

export default async function HubTrackerRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Trackers</h1>
          <p className="text-sm text-gray-500 mt-1">Choose a board to open.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BOARDS.map(board => (
            <Link
              key={board.id}
              href={board.href}
              className="group flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-900 hover:bg-gray-800 hover:border-gray-700 transition-colors px-4 py-4"
            >
              <div className="text-2xl leading-none">{board.icon}</div>
              <div className="min-w-0">
                <div className="font-semibold text-white">{board.title}</div>
                <div className="text-sm text-gray-400 mt-0.5">{board.description}</div>
              </div>
            </Link>
          ))}

          {/* Placeholder for future Monday.com boards */}
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-gray-800 bg-gray-950 px-4 py-4 opacity-70">
            <div className="text-2xl leading-none">➕</div>
            <div className="min-w-0">
              <div className="font-semibold text-gray-400">More trackers coming soon</div>
              <div className="text-sm text-gray-600 mt-0.5">Additional boards imported from Monday.com will appear here.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
