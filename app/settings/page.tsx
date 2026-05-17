import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isJobberConnected } from '@/lib/jobber'
import SettingsForm from './SettingsForm'

const DEFAULTS = {
  display_name: null as string | null,
  depot_address: null as string | null,
  depot_lat: null as number | null,
  depot_lng: null as number | null,
  default_service_minutes: 30,
  default_drive_mph: 25,
  duration_method: 'default' as string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  duration_rules: null as any,
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [settingsResult, hubUserResult, profileResult] = await Promise.all([
    supabase
      .from('user_settings')
      .select('display_name, depot_address, depot_lat, depot_lng, default_service_minutes, default_drive_mph, duration_method, duration_rules')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('hub_users')
      .select('display_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('phone')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  const settings = { ...DEFAULTS, ...(settingsResult.data ?? {}) }
  const jobberConnected = await isJobberConnected(user.id)

  const hubProfile = {
    display_name: hubUserResult.data?.display_name ?? null,
    avatar_url: hubUserResult.data?.avatar_url ?? null,
    phone: profileResult.data?.phone ?? null,
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            ← Dashboard
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
          initial={settings}
          hubProfile={hubProfile}
          jobberConnected={jobberConnected}
        />
      </main>
    </div>
  )
}
