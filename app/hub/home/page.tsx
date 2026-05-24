import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import HomeTimeClockCard, { type HomeTimeClockInitial } from '@/components/hub/home/HomeTimeClockCard'
import LandingActivity from '@/components/hub/home/LandingActivity'

export const metadata = { title: 'Home' }

function greetingFor(now: Date) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false,
    }).format(now)
  )
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function dateLabel(now: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now)
}

type AnnouncementRow = {
  id: string
  content: string
  expires_at: string
  type: 'announcement' | 'shout_out'
  archived_at: string | null
  created_at: string
}

export default async function HubHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const now = new Date()
  const nowIso = now.toISOString()

  const [meResult, announcementsResult, profileResult, employeeResult] = await Promise.all([
    supabase.from('hub_users').select('display_name').eq('id', user.id).single(),
    supabase
      .from('hub_announcements')
      .select('id, content, expires_at, type, archived_at, created_at')
      .is('archived_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('user_profiles').select('can_access_timesheet').eq('id', user.id).single(),
    supabase
      .from('employees')
      .select('id, first_name, last_name, preferred_name, job_title')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  // Time clock initial state — only fetched + rendered if user has timesheet access AND a linked employee record
  const canAccessTimesheet = profileResult.data?.can_access_timesheet ?? false
  let timeClockInitial: HomeTimeClockInitial | null = null
  if (canAccessTimesheet && employeeResult.data) {
    const { data: lastPunch } = await supabase
      .from('time_punches')
      .select('punch_type, punched_at')
      .eq('employee_id', employeeResult.data.id)
      .order('punched_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const clockedIn = lastPunch?.punch_type === 'in'
    timeClockInitial = {
      employee: employeeResult.data,
      clocked_in: clockedIn,
      since: clockedIn ? lastPunch.punched_at : null,
    }
  }

  const firstName =
    (meResult.data?.display_name ?? '').split(' ')[0] ||
    user.email?.split('@')[0] ||
    'there'

  const allActive = (announcementsResult.data ?? []) as AnnouncementRow[]
  const announcements = allActive.filter(a => a.type === 'announcement').slice(0, 5)
  const shoutOuts = allActive.filter(a => a.type === 'shout_out').slice(0, 5)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 md:py-12">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-white">{greetingFor(now)}, {firstName}</h1>
          <p className="text-sm text-gray-400 mt-1">{dateLabel(now)}</p>
        </div>

        {timeClockInitial && <HomeTimeClockCard initial={timeClockInitial} />}

        <section className="mb-10">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">📢 Announcements</h2>
          {announcements.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-500">
              No active announcements right now.
            </div>
          ) : (
            <div className="space-y-2">
              {announcements.map(a => (
                <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <p className="text-white whitespace-pre-wrap">{a.content}</p>
                  <p className="text-xs text-gray-500 mt-3">
                    Expires {new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(a.expires_at))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {shoutOuts.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs font-semibold text-amber-300/60 uppercase tracking-wider mb-3">🎉 Shout Outs</h2>
            <div className="space-y-2">
              {shoutOuts.map(a => (
                <div key={a.id} className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-5">
                  <p className="text-amber-50 whitespace-pre-wrap">{a.content}</p>
                  <p className="text-xs text-amber-200/50 mt-3">
                    Expires {new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(a.expires_at))}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <LandingActivity currentUserId={user.id} />
      </div>
    </div>
  )
}
