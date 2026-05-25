import { redirect } from 'next/navigation'
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
      .select('role, phone, full_name, landing_page, rail_config, txt_signature, can_access_tracker, can_access_routing, can_access_fleet, can_access_books, can_access_lawn, can_access_zone_sizer, can_access_call_log, can_access_timesheet, can_access_dialer')
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

  const railConfig = (profileResult.data?.rail_config ?? null) as null | {
    desktop?: (string | null)[]
    mobile?: (string | null)[]
  }

  const railPermissions = {
    isAdmin: profileResult.data?.role === 'admin',
    canAccessTracker: !!profileResult.data?.can_access_tracker,
    canAccessRouting: !!profileResult.data?.can_access_routing,
    canAccessFleet: !!profileResult.data?.can_access_fleet,
    canAccessBooks: !!profileResult.data?.can_access_books,
    canAccessLawn: !!profileResult.data?.can_access_lawn,
    canAccessZoneSizer: !!profileResult.data?.can_access_zone_sizer,
    canAccessDialer: !!profileResult.data?.can_access_dialer,
    canAccessCallLog: !!profileResult.data?.can_access_call_log,
    canAccessTimesheet: !!profileResult.data?.can_access_timesheet,
  }

  const txtSignature = (profileResult.data?.txt_signature ?? '') as string

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-2">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Settings</h1>
      </header>
      <main className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-10">
        <SettingsForm
          email={user.email ?? ''}
          userId={user.id}
          hubProfile={hubProfile}
          jobberConnected={jobberConnected}
          landingPage={landingPage}
          notifPref={notifPref}
          railConfig={railConfig}
          railPermissions={railPermissions}
          txtSignature={txtSignature}
        />
      </main>
    </div>
  )
}
