import type { Metadata, Viewport } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import HubShell from '@/components/hub/HubShell'
import PushInit from '@/components/hub/PushInit'
import ElectronNotifier from '@/components/hub/ElectronNotifier'
import HubIdleTracker from '@/components/hub/HubIdleTracker'
import { markActive } from '@/lib/hub-activity'
import { broadcastPresenceForUser } from '@/lib/hub-presence-broadcast'

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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const [memberRoomsResult, hubUsersResult, meResult, profileResult, announcementsResult, myPresenceResult] = await Promise.all([
    // Only return rooms this user is a member of (Slack-style)
    admin
      .from('room_members')
      .select('room_id, rooms!inner(id, name, is_private, archived_at)')
      .eq('user_id', user.id),
    supabase.from('hub_users').select('id, display_name, avatar_url, is_bot, status').order('display_name'),
    supabase.from('hub_users').select('display_name, status, avatar_url, last_active_at').eq('id', user.id).single(),
    supabase.from('user_profiles').select('role, hub_text_size, hub_pinned_ids, can_access_tracker, can_access_call_log, can_access_lawn, can_access_zone_sizer, can_access_timesheet, can_access_routing, can_access_books, can_access_fleet, can_access_dialer, can_admin_people, can_admin_hub, can_admin_routing, can_admin_timesheet, can_admin_fleet, can_admin_daily_log, can_admin_zone_sizer, can_admin_dialer, rail_config').eq('id', user.id).single(),
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
    routing: !!profileResult.data?.can_admin_routing,
    timesheet: !!profileResult.data?.can_admin_timesheet,
    fleet: !!profileResult.data?.can_admin_fleet,
    daily_log: !!profileResult.data?.can_admin_daily_log,
    zone_sizer: !!profileResult.data?.can_admin_zone_sizer,
  }
  const initialTextSize = profileResult.data?.hub_text_size ?? 'default'
  const initialPinnedIds: string[] = profileResult.data?.hub_pinned_ids ?? []
  const initialRailConfig = (profileResult.data?.rail_config ?? null) as null | {
    desktop?: (string | null)[]
    mobile?: (string | null)[]
  }
  const canAccessTracker = profileResult.data?.can_access_tracker ?? false
  const canAccessCallLog = profileResult.data?.can_access_call_log ?? false
  const canAccessLawn = profileResult.data?.can_access_lawn ?? false
  const canAccessTimesheet = profileResult.data?.can_access_timesheet ?? false
  const canAccessRouting = profileResult.data?.can_access_routing ?? false
  const canAccessBooks = profileResult.data?.can_access_books ?? false
  const canAccessFleet = profileResult.data?.can_access_fleet ?? false
  const canAccessZoneSizer = profileResult.data?.can_access_zone_sizer ?? false
  const canAccessDialer = profileResult.data?.can_access_dialer ?? false
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

  return (
    <>
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
        initialRailConfig={initialRailConfig as never}
        canAccessTracker={canAccessTracker}
        canAccessCallLog={canAccessCallLog}
        canAccessLawn={canAccessLawn}
        canAccessTimesheet={canAccessTimesheet}
        canAccessRouting={canAccessRouting}
        canAccessBooks={canAccessBooks}
        canAccessFleet={canAccessFleet}
        canAccessZoneSizer={canAccessZoneSizer}
        canAccessDialer={canAccessDialer}
        myPresenceMode={myPresenceMode}
      >
        {children}
      </HubShell>
      <PushInit />
      <ElectronNotifier
        currentUserId={user.id}
        hubUsers={(hubUsersResult.data ?? []) as { id: string; display_name: string; is_bot?: boolean }[]}
        rooms={rooms.map(r => ({ id: r.id, name: r.name }))}
      />
      <HubIdleTracker />
    </>
  )
}
