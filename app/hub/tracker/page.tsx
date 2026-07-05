import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Each entry is a "board" inside the Tracker section (Lead Tracker, Recurring,
// Route Capacity). Lynxedo owns leads directly — there is no Monday.com sync.
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
  {
    id: 'recurring',
    title: 'Recurring Services',
    description: 'Recurring customers — programs, retention, and annual value.',
    href: '/hub/tracker/recurring',
    icon: '🔁',
  },
  {
    id: 'route-capacity',
    title: 'Route Capacity',
    description: 'Recurring jobs by route — production time, drive time, and capacity.',
    href: '/hub/tracker/route-capacity',
    icon: '🚐',
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
        </div>
      </div>
    </div>
  )
}
