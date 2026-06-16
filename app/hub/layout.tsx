import type { Metadata, Viewport } from 'next'
import { redirect } from 'next/navigation'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, getCurrentProfile } from '@/lib/supabase/current-user'
import HubShell from '@/components/hub/HubShell'
import { HubMessagesProvider } from '@/components/hub/HubMessagesProvider'
import PushInit from '@/components/hub/PushInit'
import ElectronNotifier from '@/components/hub/ElectronNotifier'
import WebChimeNotifier from '@/components/hub/WebChimeNotifier'
import HubIdleTracker from '@/components/hub/HubIdleTracker'
import { UpdateNotifier } from '@/components/hub/UpdateNotifier'
import { ToastProvider, ConfirmProvider } from '@/components/ui'
import { markActive } from '@/lib/hub-activity'
import { broadcastPresenceForUser } from '@/lib/hub-presence-broadcast'
import { resolveLayout, reconcileSeededApps } from '@/lib/hub-layout'
import type { RailPermissions } from '@/components/hub/railCatalog'
import { SCOREBOARDS } from '@/lib/scoreboards/registry'

export const metadata: Metadata = {
  title: 'Hub',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Lynxedo Hub',
    statusBarStyle: 'black',
  },
  icons: { apple: '/icons/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  viewportFit: 'cover',
}

// iOS splash screens — React 19 hoists these <link> tags to <head>
function IosSplashScreens() {
  return (
    <>
      <link rel="apple-touch-startup-image" media="screen and (device-width:320px) and (device-height:568px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-640-1136.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:375px) and (device-height:667px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-750-1334.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:414px) and (device-height:736px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1242-2208.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:375px) and (device-height:812px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1125-2436.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:414px) and (device-height:896px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1242-2688.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:414px) and (device-height:896px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-828-1792.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:390px) and (device-height:844px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1170-2532.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:428px) and (device-height:926px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1284-2778.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:393px) and (device-height:852px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1179-2556.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:430px) and (device-height:932px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1290-2796.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:402px) and (device-height:874px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1206-2622.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:440px) and (device-height:956px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1320-2868.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:744px) and (device-height:1133px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-1488-2266.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:820px) and (device-height:1180px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-1640-2360.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:834px) and (device-height:1194px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-1668-2388.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:1024px) and (device-height:1366px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-2048-2732.png" />
    </>
  )
}

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const [memberRoomsResult, hubUsersResult, meResult, profileData, announcementsResult, myPresenceResult] = await Promise.all([
    // Only return rooms this user is a member of (Slack-style)
    admin
      .from('room_members')
      .select('room_id, rooms!inner(id, name, is_private, archived_at)')
      .eq('user_id', user.id),
    supabase.from('hub_users').select('id, display_name, avatar_url, is_bot, status').order('display_name'),
    supabase.from('hub_users').select('display_name, status, avatar_url, last_active_at').eq('id', user.id).single(),
    // Shared request-cached profile (also used by the root layout) — one query
    // for both layouts instead of two. Selects * so it satisfies every consumer.
    getCurrentProfile(),
    // Active rows for BOTH types — DB returns latest first; we keep newest per type below.
    supabase
      .from('hub_announcements')
      .select('id, content, expires_at, type, archived_at, created_by, reactions:announcement_reactions(announcement_id, user_id, emoji)')
      .is('archived_at', null)
      .gt('expires_at', now)
      .order('created_at', { ascending: false }),
    // Pull this user's own presence row from the view to decide whether the
    // client should run the 2h idle timer (only for activity-path users).
    admin.from('hub_users_with_presence').select('pay_type, employee_id').eq('id', user.id).single(),
  ])
  // Thin wrapper so the existing profileResult.data?.X reads below stay unchanged.
  const profileResult = { data: profileData }

  // Smart presence: bump last_active_at on every Hub route load (fire-and-forget).
  // Drives the salaried/unlinked path of hub_users_with_presence.effective_status.
  markActive(user.id)
  // Going-online broadcast — only fire when the user has actually crossed an
  // inactivity threshold (i.e. their effective_status likely changed from
  // offline → available). Within an active session this is a no-op, which
  // matters because the broadcast does multiple Realtime round-trips and
  // adds noticeable latency to every Hub page navigation (especially on
  // mobile cellular). 5-minute threshold matches typical "still around" feel.
  {
    const prev = meResult.data?.last_active_at
    const wasIdle = !prev || (Date.now() - new Date(prev).getTime()) > 5 * 60 * 1000
    if (wasIdle) {
      await broadcastPresenceForUser(user.id)
    }
  }

  // Server-side clocked-in lookup so the rail / mobile bar icon has the
  // correct dot on first paint. Hourly users only.
  let initialIsClockedIn = false
  if (myPresenceResult.data?.employee_id) {
    const { data: punch } = await admin
      .from('time_punches')
      .select('punch_type')
      .eq('employee_id', myPresenceResult.data.employee_id)
      .order('punched_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    initialIsClockedIn = punch?.punch_type === 'in'
  }

  type RoomShape = { id: string; name: string; is_private: boolean; archived_at: string | null }
  const rooms = (memberRoomsResult.data ?? [])
    .map(m => {
      const r = m.rooms as RoomShape | RoomShape[]
      return Array.isArray(r) ? r[0] : r
    })
    .filter((r): r is RoomShape => !!r && !r.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name))

  const isAdmin = profileResult.data?.role === 'admin'
  const adminGrants = {
    people: !!profileResult.data?.can_admin_people,
    hub: !!profileResult.data?.can_admin_hub,
    guardian: !!profileResult.data?.can_admin_guardian,
    txt: !!profileResult.data?.can_admin_txt,
    announcements: !!profileResult.data?.can_admin_announcements,
    file_tags: !!profileResult.data?.can_admin_file_tags,
    routing: !!profileResult.data?.can_admin_routing,
    timesheet: !!profileResult.data?.can_admin_timesheet,
    fleet: !!profileResult.data?.can_admin_fleet,
    daily_log: !!profileResult.data?.can_admin_daily_log,
    zone_sizer: !!profileResult.data?.can_admin_zone_sizer,
    dialer: !!profileResult.data?.can_admin_dialer,
    contacts: !!profileResult.data?.can_admin_contacts,
    products: !!profileResult.data?.can_admin_products,
    forms: !!profileResult.data?.can_admin_forms,
  }
  const initialTextSize = profileResult.data?.hub_text_size ?? 'default'
  const initialPinnedIds: string[] = profileResult.data?.hub_pinned_ids ?? []
  const legacyRailConfig = (profileResult.data?.rail_config ?? null) as null | {
    desktop?: (string | null)[]
    mobile?: (string | null)[]
  }
  const canAccessTracker = profileResult.data?.can_access_tracker ?? false
  const canAccessFiles = profileResult.data?.can_access_files ?? false
  const canAccessPesticideRecords = profileResult.data?.can_access_pesticide_records ?? false
  const canAccessHub = profileResult.data?.can_access_hub ?? false
  const canAccessCallLog = profileResult.data?.can_access_call_log ?? false
  const canAccessCallLog2 = profileResult.data?.can_access_call_log2 ?? false
  const canAccessLawn = profileResult.data?.can_access_lawn ?? false
  const canAccessTimesheet = profileResult.data?.can_access_timesheet ?? false
  const canAccessRouting = profileResult.data?.can_access_routing ?? false
  const canAccessBooks = profileResult.data?.can_access_books ?? false
  const canAccessFleet = profileResult.data?.can_access_fleet ?? false
  const canAccessZoneSizer = profileResult.data?.can_access_zone_sizer ?? false
  const canAccessDialer = profileResult.data?.can_access_dialer ?? false
  const canAccessTxt = profileResult.data?.can_access_txt ?? false
  // Txt2 "manager" = admin OR Txt-admin OR the per-user queue/broadcast grant.
  // Gates the unassigned Queue, the Responder tab, and Broadcasts in the
  // Txt2 sidebar. Mirrors lib/txt-permissions.ts so the UI matches the API.
  const canManageTxt =
    isAdmin ||
    profileResult.data?.can_admin_txt === true ||
    profileResult.data?.can_assign_txt_threads === true
  // Unified inbox (read-all lens) — admin OR the per-user flag. Mirrors the
  // conversation-page gate so the rail and the thread agree.
  const canAccessUnifiedInbox =
    isAdmin || profileResult.data?.can_access_unified_inbox === true
  const canAccessMarketing = profileResult.data?.can_access_marketing ?? false
  const canAdminMarketing = profileResult.data?.can_admin_marketing ?? false
  const canAccessForms = profileResult.data?.can_access_forms ?? true
  const canAccessDailyLogV2 = profileResult.data?.can_access_daily_log_v2 ?? false
  const rawCanAccessScoreboards = profileResult.data?.can_access_scoreboards ?? false
  const companyId = profileResult.data?.company_id ?? ''
  // A signed-in account with no company never auto-joined one (its email domain
  // didn't match a registered company in handle_new_user). Send it to a clean
  // welcome screen instead of an empty Hub. Every real user has a company, so
  // this only affects brand-new unaffiliated sign-ups (e.g. Sign in with Apple).
  if (!companyId) redirect('/welcome')
  // Per-board view access (Admin -> Scoreboards). Admins see all boards; non-admins
  // see only explicitly-granted boards, and the section is hidden entirely when they
  // have none. Only query when the section flag is on (admins skip the query too).
  const scoreboardSlugs: string[] = isAdmin
    ? SCOREBOARDS.map(b => b.slug)
    : rawCanAccessScoreboards
      ? ((await admin.from('scoreboard_board_access').select('board_slug').eq('user_id', user.id)).data ?? [])
          .map(r => r.board_slug as string)
      : []
  const canAccessScoreboards = isAdmin || (rawCanAccessScoreboards && scoreboardSlugs.length > 0)
  // Session 58.5: per-user opt-out. Defaults true server-side so any user
  // with can_access_dialer gets Hub-wide ringing on first login.
  const dialerGlobalRing = profileResult.data?.dialer_global_ring ?? true
  const initialMasterDndEnabled = profileResult.data?.master_dnd_enabled ?? false
  const initialHubDndEnabled = profileResult.data?.hub_dnd_enabled ?? false
  const initialDialerDndEnabled = profileResult.data?.dialer_dnd_enabled ?? false

  // Resolve the customizable Hub launcher layout. Uses the stored hub_layout if
  // set; otherwise migrates the legacy rail_config + pinned tools so existing
  // users keep their current rail; brand-new users get sensible defaults.
  const railPermsForLayout: RailPermissions = {
    isAdmin: !!isAdmin,
    canAccessTracker: !!canAccessTracker,
    canAccessRouting: !!canAccessRouting,
    canAccessFleet: !!canAccessFleet,
    canAccessBooks: !!canAccessBooks,
    canAccessLawn: !!canAccessLawn,
    canAccessZoneSizer: !!canAccessZoneSizer,
    canAccessDialer: !!canAccessDialer,
    canAccessTxt: !!canAccessTxt,
    canAccessCallLog: !!canAccessCallLog,
    canAccessCallLog2: !!canAccessCallLog2,
    canAccessTimesheet: !!canAccessTimesheet,
    canAccessMarketing: !!canAccessMarketing,
    canAccessForms: !!canAccessForms,
    canAccessDailyLogV2: !!canAccessDailyLogV2,
    canAccessScoreboards: !!canAccessScoreboards,
    canAccessFiles: !!canAccessFiles,
    canAccessPesticideRecords: !!canAccessPesticideRecords,
    canAccessHub: !!canAccessHub,
  }
  const resolvedLayout = resolveLayout(
    profileResult.data?.hub_layout ?? null,
    legacyRailConfig,
    initialPinnedIds,
    railPermsForLayout,
  )
  // Auto-seed every PAGE this user can access that hasn't been offered yet
  // (appended to the end of their drawer). Covers brand-new users, existing
  // users on first load after this shipped, and admin-granted access — the icon
  // appears on the user's next Hub load. Removal-safe: pages the user deleted
  // stay in hub_seeded_apps and are never re-added. Only catalog pages are
  // touched — links / DMs / rooms are left alone. Persisted fire-and-forget
  // (same best-effort pattern as markActive); this render already shows the
  // expanded list, and the write is idempotent so a failure just retries next load.
  const seed = reconcileSeededApps(
    resolvedLayout.items,
    profileResult.data?.hub_seeded_apps ?? null,
    railPermsForLayout,
  )
  const initialLayout = { version: 3 as const, items: seed.items }
  if (seed.changed) {
    const seedUpdate: Record<string, unknown> = { hub_seeded_apps: seed.seeded }
    if (seed.itemsChanged) seedUpdate.hub_layout = initialLayout
    admin
      .from('user_profiles')
      .update(seedUpdate)
      .eq('id', user.id)
      .then(() => undefined, () => undefined)
  }
  // Hourly path = linked to an employees row with pay_type='hourly'.
  // Everyone else (salary, unlinked, bots) is on the activity path.
  const myPayType = (myPresenceResult.data?.pay_type as string | null) ?? null
  const myPresenceMode: 'clock' | 'activity' =
    myPresenceResult.data?.employee_id && (myPayType ?? '').toLowerCase() === 'hourly'
      ? 'clock'
      : 'activity'

  type AnnouncementRow = {
    id: string
    content: string
    expires_at: string
    type: 'announcement' | 'shout_out'
    archived_at: string | null
    created_by: string
    reactions: Array<{ announcement_id: string; user_id: string; emoji: string }>
  }
  const rawAnnouncements = (announcementsResult.data ?? []) as AnnouncementRow[]
  // Keep the newest non-expired, non-archived row per type
  const seenTypes = new Set<string>()
  const initialActiveAnnouncements = rawAnnouncements.filter(a => {
    if (seenTypes.has(a.type)) return false
    seenTypes.add(a.type)
    return true
  }).map(a => ({
    id: a.id,
    content: a.content,
    expires_at: a.expires_at,
    type: a.type,
    archived_at: a.archived_at,
    created_by: a.created_by,
    reactions: Array.isArray(a.reactions) ? a.reactions : [],
  }))

  let buildId = 'unknown'
  try {
    buildId = fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim()
  } catch { /* dev / edge cases — notifier is a no-op when unknown */ }

  return (
    <ToastProvider>
      <ConfirmProvider>
      <HubMessagesProvider>
      <IosSplashScreens />
      <HubShell
        rooms={rooms}
        userEmail={user.email ?? ''}
        currentUserId={user.id}
        hubUsers={(hubUsersResult.data ?? []) as never}
        currentUserStatus={meResult.data?.status ?? null}
        currentUserDisplayName={meResult.data?.display_name ?? undefined}
        currentUserAvatarUrl={meResult.data?.avatar_url ?? null}
        isAdmin={isAdmin}
        adminGrants={adminGrants}
        initialActiveAnnouncements={initialActiveAnnouncements}
        initialTextSize={initialTextSize}
        initialPinnedIds={initialPinnedIds}
        initialIsClockedIn={initialIsClockedIn}
        initialLayout={initialLayout}
        canAccessTracker={canAccessTracker}
        canAccessCallLog={canAccessCallLog}
        canAccessCallLog2={canAccessCallLog2}
        canAccessLawn={canAccessLawn}
        canAccessTimesheet={canAccessTimesheet}
        canAccessRouting={canAccessRouting}
        canAccessBooks={canAccessBooks}
        canAccessFleet={canAccessFleet}
        canAccessZoneSizer={canAccessZoneSizer}
        canAccessDialer={canAccessDialer}
        canAccessTxt={canAccessTxt}
        canManageTxt={canManageTxt}
        canAccessUnifiedInbox={canAccessUnifiedInbox}
        canAccessMarketing={canAccessMarketing}
        canAdminMarketing={canAdminMarketing}
        canAccessForms={canAccessForms}
        canAccessDailyLogV2={canAccessDailyLogV2}
        canAccessScoreboards={canAccessScoreboards}
        canAccessFiles={canAccessFiles}
        canAccessPesticideRecords={canAccessPesticideRecords}
        canAccessHub={canAccessHub}
        scoreboardSlugs={scoreboardSlugs}
        companyId={companyId}
        dialerGlobalRing={dialerGlobalRing}
        myPresenceMode={myPresenceMode}
        initialMasterDndEnabled={initialMasterDndEnabled}
        initialHubDndEnabled={initialHubDndEnabled}
        initialDialerDndEnabled={initialDialerDndEnabled}
      >
        {children}
      </HubShell>
      <PushInit />
      <ElectronNotifier
        currentUserId={user.id}
        companyId={companyId}
        hubUsers={(hubUsersResult.data ?? []) as { id: string; display_name: string; is_bot?: boolean }[]}
        rooms={rooms.map(r => ({ id: r.id, name: r.name }))}
      />
      <WebChimeNotifier
        currentUserId={user.id}
        companyId={companyId}
        rooms={rooms.map(r => ({ id: r.id, name: r.name }))}
      />
      <HubIdleTracker />
      <UpdateNotifier loadedBuildId={buildId} />
      </HubMessagesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}
