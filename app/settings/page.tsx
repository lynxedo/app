import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isJobberConnected } from '@/lib/jobber'
import SettingsForm from './SettingsForm'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [hubUserResult, profileResult, notifPrefResult] = await Promise.all([
    supabase
      .from('hub_users')
      .select('display_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('phone, full_name, landing_page')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('notification_prefs')
      .select('level, dnd_enabled, dnd_start, dnd_end')
      .eq('user_id', user.id)
      .is('room_id', null)
      .maybeSingle(),
  ])

  const jobberConnected = await isJobberConnected(user.id)

  const hubProfile = {
    full_name: profileResult.data?.full_name ?? null,
    display_name: hubUserResult.data?.display_name ?? null,
    avatar_url: hubUserResult.data?.avatar_url ?? null,
    phone: profileResult.data?.phone ?? null,
  }

  const landingPage = (profileResult.data?.landing_page ?? 'hub') as 'hub' | 'dashboard'

  const notifPref = {
    level: (notifPrefResult.data?.level ?? 'all') as 'all' | 'mentions' | 'muted',
    dnd_enabled: notifPrefResult.data?.dnd_enabled ?? false,
    dnd_start: notifPrefResult.data?.dnd_start ?? null,
    dnd_end: notifPrefResult.data?.dnd_end ?? null,
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/hub"
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            ← Hub
          </Link>
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user.email}</span>
          <Link href="/help" className="text-gray-400 hover:text-white transition-colors text-lg leading-none font-bold" title="Help">
            ?
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-2xl mx-auto px-6 py-10">
        <SettingsForm
          email={user.email ?? ''}
          userId={user.id}
          hubProfile={hubProfile}
          jobberConnected={jobberConnected}
          landingPage={landingPage}
          notifPref={notifPref}
        />
      </main>
    </div>
  )
}
