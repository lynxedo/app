import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGrantedBoardSlugs } from '@/lib/scoreboards/access'
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
      .select('role, company_id, phone, full_name, landing_page, rail_config, txt_signature, dialer_global_ring, hub_theme, can_access_tracker, can_access_routing, can_access_fleet, can_access_books, can_access_lawn, can_access_zone_sizer, can_access_call_log, can_access_call_log2, can_access_timesheet, can_access_dialer, can_access_txt, can_access_marketing, can_access_email, can_manage_drip, can_access_forms, can_access_daily_log_v2, can_access_scoreboards, can_access_files, can_access_pesticide_records, can_access_pricer, can_access_hub, can_access_beta, master_dnd_enabled, master_dnd_schedule, hub_dnd_enabled, hub_dnd_schedule, dialer_dnd_enabled, dialer_dnd_schedule')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('notification_prefs')
      .select('level')
      .eq('user_id', user.id)
      .is('room_id', null)
      .maybeSingle(),
  ])

  const hubProfile = {
    full_name: profileResult.data?.full_name ?? null,
    display_name: hubUserResult.data?.display_name ?? null,
    avatar_url: hubUserResult.data?.avatar_url ?? null,
    phone: profileResult.data?.phone ?? null,
  }

  const landingPage = (profileResult.data?.landing_page ?? 'hub') as 'hub' | 'dashboard'

  const notifPref = {
    level: (notifPrefResult.data?.level ?? 'all') as 'all' | 'mentions' | 'muted',
  }

  // Scoreboards is gated per-board (Admin -> Scoreboards): a user with the section
  // flag but no granted boards effectively has no access, so don't offer it as a
  // pinnable rail tool. Admins always have it.
  const isSettingsAdmin = profileResult.data?.role === 'admin'
  // Beta Features tab shows for admins + anyone with the can_access_beta grant.
  const canAccessBeta = isSettingsAdmin || !!profileResult.data?.can_access_beta
  const effectiveCanAccessScoreboards =
    isSettingsAdmin ||
    (!!profileResult.data?.can_access_scoreboards &&
      (await getGrantedBoardSlugs(supabase, user.id)).length > 0)
  const railPermissions = {
    isAdmin: profileResult.data?.role === 'admin',
    canAccessTracker: !!profileResult.data?.can_access_tracker,
    canAccessRouting: !!profileResult.data?.can_access_routing,
    canAccessFleet: !!profileResult.data?.can_access_fleet,
    canAccessBooks: !!profileResult.data?.can_access_books,
    canAccessLawn: !!profileResult.data?.can_access_lawn,
    canAccessZoneSizer: !!profileResult.data?.can_access_zone_sizer,
    canAccessDialer: !!profileResult.data?.can_access_dialer,
    canAccessTxt: !!profileResult.data?.can_access_txt,
    canAccessMarketing: !!profileResult.data?.can_access_marketing,
    canAccessEmail: !!profileResult.data?.can_access_email,
    canManageDrip: !!profileResult.data?.can_manage_drip,
    canAccessCallLog: !!profileResult.data?.can_access_call_log,
    canAccessCallLog2: !!profileResult.data?.can_access_call_log2,
    canAccessTimesheet: !!profileResult.data?.can_access_timesheet,
    canAccessForms: !!profileResult.data?.can_access_forms,
    canAccessDailyLogV2: !!profileResult.data?.can_access_daily_log_v2,
    canAccessScoreboards: effectiveCanAccessScoreboards,
    canAccessFiles: !!profileResult.data?.can_access_files,
    canAccessPesticideRecords: !!profileResult.data?.can_access_pesticide_records,
    canAccessPricer: !!profileResult.data?.can_access_pricer,
    canAccessHub: !!profileResult.data?.can_access_hub,
  }

  // Company signature policy: when allow_user_signatures is off, the personal
  // signature field is hidden and everyone uses the company default. Read with
  // the admin client (normal users have no SELECT on txt_settings).
  let allowUserSignatures = true
  let companyDefaultSignature: string | null = null
  const settingsCompanyId = (profileResult.data as { company_id?: string | null } | null)?.company_id ?? null
  if (settingsCompanyId) {
    const { data: txtSettings } = await createAdminClient()
      .from('txt_settings')
      .select('allow_user_signatures, company_default_signature')
      .eq('company_id', settingsCompanyId)
      .maybeSingle()
    const ts = txtSettings as { allow_user_signatures?: boolean | null; company_default_signature?: string | null } | null
    allowUserSignatures = ts?.allow_user_signatures !== false
    companyDefaultSignature = ts?.company_default_signature ?? null
  }

  const txtSignature = (profileResult.data?.txt_signature ?? '') as string
  const dialerGlobalRing = profileResult.data?.dialer_global_ring ?? true
  const initialMasterDndEnabled = profileResult.data?.master_dnd_enabled ?? false
  const initialMasterDndSchedule = (profileResult.data?.master_dnd_schedule ?? null) as Record<string, unknown> | null
  const initialHubDndEnabled = profileResult.data?.hub_dnd_enabled ?? false
  const initialHubDndSchedule = (profileResult.data?.hub_dnd_schedule ?? null) as Record<string, unknown> | null
  const initialDialerDndEnabled = profileResult.data?.dialer_dnd_enabled ?? false
  const initialDialerDndSchedule = (profileResult.data?.dialer_dnd_schedule ?? null) as Record<string, unknown> | null

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-2">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Settings</h1>
      </header>
      <main className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-10">
        <Suspense fallback={<div className="h-64" />}>
        <SettingsForm
          email={user.email ?? ''}
          userId={user.id}
          hubProfile={hubProfile}
          initialTheme={(profileResult.data?.hub_theme ?? 'midnight') as string}
          landingPage={landingPage}
          notifPref={notifPref}
          railPermissions={railPermissions}
          canAccessBeta={canAccessBeta}
          txtSignature={txtSignature}
          allowUserSignatures={allowUserSignatures}
          companyDefaultSignature={companyDefaultSignature}
          dialerGlobalRing={dialerGlobalRing}
          initialMasterDndEnabled={initialMasterDndEnabled}
          initialMasterDndSchedule={initialMasterDndSchedule}
          initialHubDndEnabled={initialHubDndEnabled}
          initialHubDndSchedule={initialHubDndSchedule}
          initialDialerDndEnabled={initialDialerDndEnabled}
          initialDialerDndSchedule={initialDialerDndSchedule}
        />
        </Suspense>
      </main>
    </div>
  )
}
