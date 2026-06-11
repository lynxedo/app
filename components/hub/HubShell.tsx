'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'
import HubSidebar from './HubSidebar'
import HubRail, { railFromPath } from './HubRail'
import HubMobileBar from './HubMobileBar'
import HubMobileMore from './HubMobileMore'
import AppLauncherPanel from './AppLauncherPanel'
import LayoutEditor from './LayoutEditor'
import HubActivityPanel from './HubActivityBell'
import ToolsSidebar from './sidebars/ToolsSidebar'
import LinksSidebar from './sidebars/LinksSidebar'
import AdminSidebar from './sidebars/AdminSidebar'
import SettingsSidebar from './sidebars/SettingsSidebar'
import ProfileSidebar from './sidebars/ProfileSidebar'
import ActivitySidebar from './sidebars/ActivitySidebar'
import TxtSidebar from './sidebars/TxtSidebar'
import TxtV2Sidebar from './sidebars/TxtV2Sidebar'
import DialerSidebar from './sidebars/DialerSidebar'
import AnnouncementTicker, { type Announcement } from './AnnouncementTicker'
import HubQuickCompose from './HubQuickCompose'
import TimesheetClockModal from './TimesheetClockModal'
import NotifPrefsModal from './NotifPrefsModal'
import DialerProvider from './dialer/DialerProvider'
import GlobalCallBar from './dialer/GlobalCallBar'
import OnCallPresenceProvider from './OnCallPresenceProvider'
import { useHubVoicemailCount } from '@/hooks/use-hub-voicemail-count'
import { useHubMissedCall } from '@/hooks/use-hub-missed-call'
import { HubTextSizeContext } from './HubTextSizeContext'
import { createClient } from '@/lib/supabase/client'
import type { HubUser } from './MessageFeed'
import { catalogEntriesFor, type RailPermissions } from './railCatalog'
import { type HubLayout } from '@/lib/hub-layout'
import { persistStorage } from '@/lib/hub-cache'

type Room = { id: string; name: string; is_private: boolean }
type RailConversation = { id: string; participants: { id: string; display_name: string; avatar_url?: string | null }[] }

export const HUB_CONV_CREATED_EVENT = 'hub-conversation-created'

// Sections that have a sidebar of their own. Driven by a manual override
// (rail click) for sections that have no URL (tools, links, profile).
type ManualRail = 'tools' | 'links' | 'profile' | 'activity' | null

export default function HubShell({
  rooms,
  userEmail,
  currentUserId,
  hubUsers,
  currentUserStatus,
  currentUserDisplayName,
  currentUserAvatarUrl,
  isAdmin,
  adminGrants,
  initialActiveAnnouncements,
  initialTextSize,
  initialPinnedIds,
  initialIsClockedIn,
  initialLayout,
  canAccessTracker,
  canAccessCallLog,
  canAccessCallLog2,
  canAccessLawn,
  canAccessTimesheet,
  canAccessRouting,
  canAccessBooks,
  canAccessFleet,
  canAccessZoneSizer,
  canAccessDialer,
  canAccessTxt,
  canAccessMarketing,
  canAdminMarketing,
  canAccessForms,
  canAccessDailyLogV2,
  companyId,
  dialerGlobalRing,
  myPresenceMode,
  children,
}: {
  rooms: Room[]
  userEmail: string
  currentUserId: string
  hubUsers: HubUser[]
  currentUserStatus?: string | null
  currentUserDisplayName?: string
  currentUserAvatarUrl?: string | null
  isAdmin?: boolean
  adminGrants?: {
    people: boolean
    hub: boolean
    routing: boolean
    timesheet: boolean
    fleet: boolean
    daily_log: boolean
    zone_sizer: boolean
    dialer: boolean
    contacts?: boolean
    products?: boolean
    forms?: boolean
  }
  initialActiveAnnouncements?: Announcement[]
  initialTextSize?: string
  initialPinnedIds?: string[]
  initialIsClockedIn?: boolean
  initialLayout?: HubLayout | null
  canAccessTracker?: boolean
  canAccessCallLog?: boolean
  canAccessCallLog2?: boolean
  canAccessLawn?: boolean
  canAccessTimesheet?: boolean
  canAccessRouting?: boolean
  canAccessBooks?: boolean
  canAccessFleet?: boolean
  canAccessZoneSizer?: boolean
  canAccessDialer?: boolean
  canAccessTxt?: boolean
  canAccessMarketing?: boolean
  canAdminMarketing?: boolean
  canAccessForms?: boolean
  canAccessDailyLogV2?: boolean
  companyId?: string
  /** Session 58.5: when true (default) AND canAccessDialer, the Twilio
   *  Device registers on every Hub page so IncomingCall pops anywhere. */
  dialerGlobalRing?: boolean
  myPresenceMode?: 'clock' | 'activity'
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ''
  const pathRail = railFromPath(pathname)
  // Held in a ref so the Daily Log broadcast effect can read the live path
  // without re-subscribing its Supabase channel on every navigation.
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const [manualRail, setManualRail] = useState<ManualRail>(null)
  useEffect(() => { setManualRail(null) }, [pathname])

  // Deep link from Settings → My Hub: /hub?customize=1 opens the layout editor.
  // Read on the client to avoid a Suspense requirement from useSearchParams.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('customize') === '1') {
        setShowLayoutEditor(true)
      }
    } catch { /* ignore */ }
  }, [])

  // Ask the platform for durable IndexedDB storage so the Hub cache survives
  // memory pressure on iOS WKWebView and other constrained environments.
  // Idempotent; no UI prompt; safe to ignore the result.
  useEffect(() => { void persistStorage() }, [])

  const activeRail = manualRail ?? pathRail

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [showMobileMore, setShowMobileMore] = useState(false)
  const [showDesktopLauncher, setShowDesktopLauncher] = useState(false)
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)
  const EMPTY_LAYOUT: HubLayout = { version: 3, items: [] }
  const [liveLayout, setLiveLayout] = useState<HubLayout>(initialLayout ?? EMPTY_LAYOUT)
  // Lightweight conversation list so DM tokens on the rail/dock/drawer can show
  // a label + avatar. (The sidebar fetches its own richer copy.)
  const [railConversations, setRailConversations] = useState<RailConversation[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/conversations')
      .then(r => (r.ok ? r.json() : { conversations: [] }))
      .then(d => { if (!cancelled) setRailConversations((d.conversations ?? []) as RailConversation[]) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [showTimeClock, setShowTimeClock] = useState(false)
  const [showNotifPrefs, setShowNotifPrefs] = useState(false)
  const [textSize, setTextSize] = useState(initialTextSize ?? 'default')
  const [liveStatus, setLiveStatus] = useState<string | null>(currentUserStatus ?? null)
  const [unreadActivity, setUnreadActivity] = useState<number>(0)
  const [unreadHub, setUnreadHub] = useState<boolean>(false)
  const [dailyLogUnread, setDailyLogUnread] = useState<boolean>(false)
  const [txtUnread, setTxtUnread] = useState<boolean>(false)
  const [missedCall, setMissedCall] = useState<boolean>(false)
  const [showActivity, setShowActivity] = useState(false)
  const [isClockedIn, setIsClockedIn] = useState<boolean>(!!initialIsClockedIn)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  // Viewport breakpoint detection — used to skip the mobile-bottom-bar
  // padding on desktop (no tab bar there).
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Sidebar collapsed state — persisted.
  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem('hub-sidebar-collapsed') === '1') } catch {}
  }, [])
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('hub-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }, [])
  // Force the sidebar open (no toggle). Used when rail icons navigate to a
  // different section — Ben's UX rule: clicking a nav icon should make the
  // sidebar visible regardless of its prior collapsed state.
  const openSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      if (!prev) return prev
      try { localStorage.setItem('hub-sidebar-collapsed', '0') } catch {}
      return false
    })
  }, [])

  // Remember last chat path for the rail's Hub icon to jump back to.
  useEffect(() => {
    if (pathRail === 'hub' && pathname.startsWith('/hub') && !pathname.startsWith('/hub/home')) {
      try { localStorage.setItem('hub_last_chat_route', pathname) } catch {}
    }
  }, [pathname, pathRail])

  // Root font-size scaling sync.
  useEffect(() => {
    const html = document.documentElement
    html.classList.remove('text-size-small', 'text-size-default', 'text-size-large')
    html.classList.add(`text-size-${textSize}`)
  }, [textSize])

  // Mirror keyboardOpen onto the body so CSS can react. Headers tagged with
  // data-hide-on-keyboard collapse on mobile when the composer is focused.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (keyboardOpen) {
      document.body.setAttribute('data-keyboard-open', 'true')
    } else {
      document.body.removeAttribute('data-keyboard-open')
    }
    return () => { document.body.removeAttribute('data-keyboard-open') }
  }, [keyboardOpen])

  // Visual Viewport: track scroll offset for iOS fixed-bar following AND
  // detect keyboard-open (height shrink) so we can hide mobile chrome.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const initialHeight = window.innerHeight
    function update() {
      document.documentElement.style.setProperty('--vv-top', `${vv!.offsetTop}px`)
      // Keyboard open heuristic: visual viewport noticeably shorter than
      // window inner height. Threshold 150px filters out toolbar collapse
      // (Safari ~80px). 150px is a typical software keyboard floor.
      const shrunk = (initialHeight - vv!.height) > 150
      setKeyboardOpen(shrunk)
    }
    vv.addEventListener('scroll', update)
    vv.addEventListener('resize', update)
    update()
    return () => {
      vv.removeEventListener('scroll', update)
      vv.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--vv-top')
    }
  }, [])

  // Cmd+K / Ctrl+K opens Quick Compose.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCompose(prev => !prev)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Activity unread count poll.
  useEffect(() => {
    let cancelled = false
    function tick() {
      fetch('/api/hub/activity?count_only=1', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : { unreadCount: 0 })
        .then(d => { if (!cancelled) setUnreadActivity(d.unreadCount ?? 0) })
        .catch(() => {})
    }
    tick()
    const id = setInterval(tick, 90_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [pathname])

  // Authoritative unread refresh for the Hub rail icon dot (any unread room/DM)
  // + the Daily Log dot. Reads the same read-receipts endpoint the sidebar uses.
  // pathname is read via ref so this is a stable callback.
  const refreshHubUnread = useCallback(() => {
    fetch('/api/hub/read-receipts', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { unread_room_ids: [], unread_conv_ids: [], daily_log_unread: false })
      .then(d => {
        const any =
          (Array.isArray(d.unread_room_ids) && d.unread_room_ids.length > 0) ||
          (Array.isArray(d.unread_conv_ids) && d.unread_conv_ids.length > 0)
        setUnreadHub(any)
        // Don't show the Daily Log dot while the user is viewing Daily Log.
        const path = pathnameRef.current
        const onDailyLog = path === '/hub/daily-log' || path.startsWith('/hub/daily-log/')
        setDailyLogUnread(d.daily_log_unread === true && !onDailyLog)
      })
      .catch(() => {})
  }, [])

  // Refresh on every navigation + a 60s safety poll.
  useEffect(() => {
    refreshHubUnread()
    const id = setInterval(refreshHubUnread, 60_000)
    return () => clearInterval(id)
  }, [pathname, refreshHubUnread])

  // Realtime: light the Hub rail icon dot the instant a new message arrives
  // (instead of waiting up to 60s for the poll). On a qualifying insert we pull
  // the authoritative read-receipts state so the dot also clears on read.
  // postgres_changes covers normal message inserts; the 60s poll backstops the
  // rare admin-client insert (Slack bridge) that postgres_changes can drop.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('shell-hub-unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as { sender_id?: string; parent_id?: string | null }
          if (!msg?.sender_id || msg.sender_id === currentUserId || msg.parent_id) return
          refreshHubUnread()
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUserId, refreshHubUnread])

  // Mark Daily Log read + clear the dot when the user opens it. (/hub/daily-log
  // only — Daily Log v2 lives at /hub/daily-log-v2 and is intentionally untouched.)
  useEffect(() => {
    const onDailyLog = pathname === '/hub/daily-log' || pathname.startsWith('/hub/daily-log/')
    if (!onDailyLog) return
    setDailyLogUnread(false)
    fetch('/api/hub/read-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_log: true }),
    }).catch(() => {})
  }, [pathname])

  // Live Daily Log signal — company broadcast fired by the update-posted route.
  // daily_log_updates isn't in the Realtime publication, so this broadcast is
  // the instant path (the 60s poll above is the backstop). Only light the dot
  // if this user is one of the update's recipients and isn't already viewing it.
  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`daily-log:${companyId}`)
      .on('broadcast', { event: 'update-inserted' }, ({ payload }) => {
        const p = (payload ?? {}) as { recipient_ids?: string[]; sender_id?: string }
        if (p.sender_id === currentUserId) return
        if (!Array.isArray(p.recipient_ids) || !p.recipient_ids.includes(currentUserId)) return
        const path = pathnameRef.current
        if (path === '/hub/daily-log' || path.startsWith('/hub/daily-log/')) return
        setDailyLogUnread(true)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // pathname read via pathnameRef so we don't tear down + re-subscribe the
    // channel on every navigation (matches the HubSidebar messages pattern).
  }, [companyId, currentUserId])

  // Session 58.5: poll unheard voicemail count for the rail badge. Gated on
  // canAccessDialer so non-dialer users don't hit the endpoint.
  const unheardVoicemails = useHubVoicemailCount(!!canAccessDialer)

  // ── Txt2 unread dot ───────────────────────────────────────────────────────
  // Orange dot on the Txt2 rail icon when there's a newer customer inbound than
  // the last time this device opened Txt2 (per-device, like the chime pref).
  // Mirrors the Daily Log dot: 60s poll + the instant inbound broadcast.
  const TXT_SEEN_KEY = 'txt-last-seen'
  const refreshTxtUnread = useCallback(() => {
    if (!canAccessTxt) { setTxtUnread(false); return }
    const path = pathnameRef.current
    if (path === '/hub/txt' || path.startsWith('/hub/txt/')) { setTxtUnread(false); return }
    fetch('/api/txt/unread', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { latest_inbound_at: null }))
      .then(d => {
        const latest: string | null = d.latest_inbound_at ?? null
        if (!latest) { setTxtUnread(false); return }
        let seen = ''
        try { seen = localStorage.getItem(TXT_SEEN_KEY) || '' } catch { /* ignore */ }
        setTxtUnread(!seen || latest > seen)
      })
      .catch(() => {})
  }, [canAccessTxt])

  useEffect(() => {
    if (!canAccessTxt) return
    refreshTxtUnread()
    const id = setInterval(refreshTxtUnread, 60_000)
    return () => clearInterval(id)
  }, [pathname, canAccessTxt, refreshTxtUnread])

  // Instant: light the dot on the inbound broadcast (same topic the inbound
  // webhook fires; the daily-log dot uses this exact two-subscriber pattern).
  useEffect(() => {
    if (!canAccessTxt || !companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`txt:${companyId}`)
      .on('broadcast', { event: 'inbound' }, () => {
        const path = pathnameRef.current
        if (path === '/hub/txt' || path.startsWith('/hub/txt/')) return
        setTxtUnread(true)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [canAccessTxt, companyId])

  // Refresh the Txt2 dot when the tab/app regains focus — the realtime inbound
  // broadcast covers the live case, but if the socket dropped while backgrounded
  // (common on mobile) this catches up immediately instead of waiting up to 60s.
  useEffect(() => {
    if (!canAccessTxt) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshTxtUnread()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [canAccessTxt, refreshTxtUnread])

  // Clear + stamp last-seen when the user opens Txt2.
  useEffect(() => {
    const onTxt = pathname === '/hub/txt' || pathname.startsWith('/hub/txt/')
    if (!onTxt) return
    setTxtUnread(false)
    try { localStorage.setItem(TXT_SEEN_KEY, new Date().toISOString()) } catch { /* ignore */ }
  }, [pathname])

  // ── Dialer missed-call dot ────────────────────────────────────────────────
  // Orange dot on the Dialer rail icon when there's a missed inbound call newer
  // than the last time this device opened the Dialer. Distinct from the red
  // unheard-voicemail count badge (a missed call may not leave a voicemail).
  const latestMissedAt = useHubMissedCall(!!canAccessDialer)
  const DIALER_SEEN_KEY = 'dialer-missed-seen'
  useEffect(() => {
    const onDialer = pathname === '/hub/dialer' || pathname.startsWith('/hub/dialer/')
    if (onDialer) {
      setMissedCall(false)
      try { localStorage.setItem(DIALER_SEEN_KEY, latestMissedAt || new Date().toISOString()) } catch { /* ignore */ }
      return
    }
    if (!latestMissedAt) { setMissedCall(false); return }
    let seen = ''
    try { seen = localStorage.getItem(DIALER_SEEN_KEY) || '' } catch { /* ignore */ }
    setMissedCall(!seen || latestMissedAt > seen)
  }, [latestMissedAt, pathname])

  // Whether to lift the Twilio Device registration up to shell level. When
  // false, IncomingCall only renders on /hub/dialer (original Session 56
  // behavior, e.g. user opted out via Settings or doesn't have dialer access).
  const liftDialerDevice = !!canAccessDialer && (dialerGlobalRing !== false)

  // Clocked-in status: refresh from API on focus + after Time Clock modal closes
  // (the modal handles the punch itself). Initial value comes from server props.
  const refreshClockedIn = useCallback(() => {
    fetch('/api/timesheet/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.clocked_in != null) setIsClockedIn(!!d.clocked_in) })
      .catch(() => {})
  }, [])
  useEffect(() => {
    const onFocus = () => refreshClockedIn()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshClockedIn])

  const handleConversationCreated = useCallback(() => {
    window.dispatchEvent(new CustomEvent(HUB_CONV_CREATED_EVENT))
  }, [])

  const closeMobileDrawer = useCallback(() => setMobileDrawerOpen(false), [])

  // Persist the customizable Hub launcher layout (rail + mobile bar). Optimistic:
  // the rail/bar update instantly behind the editor, reverting only on failure.
  const saveLayout = useCallback(async (next: HubLayout) => {
    setLiveLayout(prev => {
      const rollback = prev
      fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub_layout: next }),
      })
        .then(res => { if (!res.ok) setLiveLayout(rollback) })
        .catch(() => setLiveLayout(rollback))
      return next
    })
  }, [])

  // DND quick-toggle (sys:dnd rail/bar item). Flips status dnd ⇄ available.
  const toggleDnd = useCallback(() => {
    setLiveStatus(prev => {
      const next = prev === 'dnd' ? 'available' : 'dnd'
      fetch('/api/hub/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      }).then(res => { if (!res.ok) setLiveStatus(prev) }).catch(() => setLiveStatus(prev))
      return next
    })
  }, [])

  const rawGrants = adminGrants ?? {
    people: !!isAdmin, hub: !!isAdmin, routing: !!isAdmin,
    timesheet: !!isAdmin, fleet: !!isAdmin, daily_log: !!isAdmin, zone_sizer: !!isAdmin,
    dialer: !!isAdmin, contacts: !!isAdmin, products: !!isAdmin,
  }
  const grants = {
    people: !!rawGrants.people,
    hub: !!rawGrants.hub,
    routing: !!rawGrants.routing,
    timesheet: !!rawGrants.timesheet,
    fleet: !!rawGrants.fleet,
    daily_log: !!rawGrants.daily_log,
    zone_sizer: !!rawGrants.zone_sizer,
    dialer: !!rawGrants.dialer,
    contacts: !!rawGrants.contacts,
    products: !!rawGrants.products,
    forms: !!(rawGrants.forms ?? isAdmin),
  }
  const isSuperAdmin = !!isAdmin
  const showAdminRail =
    isSuperAdmin || grants.people || grants.hub || grants.routing ||
    grants.timesheet || grants.fleet || grants.daily_log || grants.zone_sizer ||
    grants.dialer || grants.contacts || grants.products || grants.forms

  const permissions: RailPermissions = {
    isAdmin: !!isAdmin,
    canAccessTracker: !!canAccessTracker,
    canAccessRouting: !!canAccessRouting,
    canAccessFleet: !!canAccessFleet,
    canAccessBooks: !!canAccessBooks,
    canAccessLawn: !!canAccessLawn,
    canAccessCallLog: !!canAccessCallLog,
    canAccessCallLog2: !!canAccessCallLog2,
    canAccessTimesheet: !!canAccessTimesheet,
    canAccessZoneSizer: !!canAccessZoneSizer,
    canAccessDialer: !!canAccessDialer,
    canAccessTxt: !!canAccessTxt,
    canAccessMarketing: !!canAccessMarketing,
    canAccessForms: !!canAccessForms,
    canAccessDailyLogV2: !!canAccessDailyLogV2,
  }

  function renderSidebar() {
    const collapseProps = { onDesktopCollapse: toggleSidebarCollapsed }
    switch (activeRail) {
      case 'dialer':
        return (
          <DialerSidebar
            onClose={closeMobileDrawer}
            canSeeAll={!!isAdmin || !!adminGrants?.dialer}
            canText={!!canAccessTxt}
            {...collapseProps}
          />
        )
      case 'txt':
        // 'txt' rail = old Captivated /hub/clients (everyone). New Twilio
        // /hub/txt maps to the gated 'txt2' rail below.
        return <TxtSidebar onClose={closeMobileDrawer} {...collapseProps} />
      case 'txt2':
        return (
          <TxtV2Sidebar
            onClose={closeMobileDrawer}
            {...collapseProps}
            canAssign={!!isAdmin || !!adminGrants?.hub}
            canCall={!!canAccessDialer}
            currentUserId={currentUserId}
          />
        )
      case 'tools':
        return (
          <ToolsSidebar
            isAdmin={!!isAdmin}
            canAccessRouting={!!canAccessRouting}
            canAccessTracker={!!canAccessTracker}
            canAccessLawn={!!canAccessLawn}
            canAccessZoneSizer={!!canAccessZoneSizer}
            canAccessCallLog={!!canAccessCallLog}
            canAccessCallLog2={!!canAccessCallLog2}
            canAccessBooks={!!canAccessBooks}
            canAccessFleet={!!canAccessFleet}
            canAccessTimesheet={!!canAccessTimesheet}
            canAccessDialer={!!canAccessDialer}
            canAccessMarketing={!!canAccessMarketing}
            canAdminMarketing={!!canAdminMarketing}
            canAccessForms={!!canAccessForms}
            onClose={closeMobileDrawer}
            {...collapseProps}
          />
        )
      case 'links':
        return <LinksSidebar onClose={closeMobileDrawer} {...collapseProps} />
      case 'activity':
        return <ActivitySidebar onClose={closeMobileDrawer} {...collapseProps} />
      case 'admin':
        return <AdminSidebar grants={grants} isSuperAdmin={isSuperAdmin} onClose={closeMobileDrawer} {...collapseProps} />
      case 'settings':
        return <SettingsSidebar onClose={closeMobileDrawer} {...collapseProps} />
      case 'profile':
        return (
          <ProfileSidebar
            userId={currentUserId}
            displayName={currentUserDisplayName ?? userEmail.split('@')[0]}
            userEmail={userEmail}
            avatarUrl={currentUserAvatarUrl ?? null}
            initialStatus={liveStatus}
            textSize={textSize}
            onTextSizeChange={setTextSize}
            onOpenNotifPrefs={() => setShowNotifPrefs(true)}
            onOpenActivity={() => { closeMobileDrawer(); setShowActivity(true) }}
            unreadActivity={unreadActivity}
            onStatusChanged={s => setLiveStatus(s ?? null)}
            onClose={closeMobileDrawer}
            {...collapseProps}
          />
        )
      // hub + every other catalog id (tracker, routing, etc.) → Hub sidebar
      case 'hub':
      default:
        return (
          <HubSidebar
            rooms={rooms}
            userEmail={userEmail}
            currentUserId={currentUserId}
            hubUsers={hubUsers}
            currentUserStatus={liveStatus}
            currentUserDisplayName={currentUserDisplayName}
            isAdmin={isAdmin}
            onClose={closeMobileDrawer}
            onDesktopCollapse={toggleSidebarCollapsed}
            textSize={textSize}
            onTextSizeChange={setTextSize}
            initialPinnedIds={initialPinnedIds ?? []}
            canAccessTracker={canAccessTracker}
            canAccessCallLog={canAccessCallLog}
            canAccessLawn={canAccessLawn}
            canAccessZoneSizer={canAccessZoneSizer}
            canAccessDialer={canAccessDialer}
            canAccessTimesheet={canAccessTimesheet}
            canAccessRouting={canAccessRouting}
            canAccessBooks={canAccessBooks}
            canAccessFleet={canAccessFleet}
            canAccessDailyLogV2={canAccessDailyLogV2}
            dailyLogUnread={dailyLogUnread}
            myPresenceMode={myPresenceMode}
            onOpenTimeClock={() => { closeMobileDrawer(); setShowTimeClock(true) }}
          />
        )
    }
  }

  // Landing page has no useful sidebar — hide the in-flow sidebar there.
  // Otherwise show unless explicitly collapsed.
  const hideSidebarDesktop = pathname.startsWith('/hub/home') || sidebarCollapsed
  // Inert when sidebar is collapsed on desktop, so its inner buttons aren't
  // focusable / hit-testable while it's at 0 width.
  const sidebarInert = hideSidebarDesktop && !mobileDrawerOpen


  const shell = (
    <HubTextSizeContext.Provider value={textSize}>
    <div className="flex h-[100dvh] bg-gray-950 text-white overflow-hidden">
      {mobileDrawerOpen && (
        <div
          className="fixed left-0 right-0 top-0 z-40 bg-black/60 md:hidden"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 56px)' }}
          onClick={closeMobileDrawer}
        />
      )}

      <HubRail
        showAdmin={showAdminRail}
        unreadActivity={unreadActivity}
        unreadHub={unreadHub}
        dailyLogUnread={dailyLogUnread}
        txtUnread={txtUnread}
        missedCall={missedCall}
        unheardVoicemails={unheardVoicemails}
        isClockedIn={isClockedIn}
        onSearchClick={() => setShowCompose(true)}
        onProfileClick={() => setManualRail('profile')}
        onToolsClick={() => setManualRail('tools')}
        onLinksClick={() => setManualRail('links')}
        onTimeClockClick={() => setShowTimeClock(true)}
        onActivityClick={() => setShowActivity(true)}
        onOpenLauncher={() => setShowDesktopLauncher(v => !v)}
        onToggleDnd={toggleDnd}
        onOpenLayoutEditor={() => setShowLayoutEditor(true)}
        currentUserId={currentUserId}
        currentUserDisplayName={currentUserDisplayName}
        currentUserAvatarUrl={currentUserAvatarUrl ?? null}
        currentUserStatus={liveStatus}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        onOpenSidebar={openSidebar}
        activeManualRail={manualRail}
        permissions={permissions}
        items={liveLayout.items}
        rooms={rooms}
        conversations={railConversations}
        launcherOpen={showDesktopLauncher}
      />

      <div
        className={`
          fixed top-0 left-0 z-50 md:relative md:z-auto md:inset-y-0 md:bottom-auto
          transform transition-transform duration-200 ease-in-out
          ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          md:overflow-hidden
          ${hideSidebarDesktop ? 'md:w-0' : 'md:w-72'}
        `}
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 56px)' }}
        aria-hidden={sidebarInert ? true : undefined}
        inert={sidebarInert ? true : undefined}
      >
        {renderSidebar()}
      </div>

      {/* Mobile: persistent "open sidebar" chevron, upper-left, on EVERY Hub
          screen while the drawer is closed. Apps launched from the Apps drawer
          (tracker, fleet, daily-log, files, …) have no bottom-bar button to
          reveal their sidebar — this floating chevron is the universal way in,
          and it also replaces the room/DM/client header (hidden via
          data-hide-on-keyboard) while the soft keyboard is up. Page headers are
          padded left on mobile so it never overlaps content — chat headers via
          the global [data-hide-on-keyboard] rule in globals.css, tool headers
          via per-page max-md:pl-14. setManualRail(null) makes the drawer render
          the current page's own sidebar. */}
      {!mobileDrawerOpen && (
        <button
          type="button"
          onClick={() => { setManualRail(null); setMobileDrawerOpen(true) }}
          className="md:hidden fixed left-2 z-40 w-9 h-9 rounded-full bg-gray-900/80 backdrop-blur border border-white/10 text-white/80 hover:text-white flex items-center justify-center shadow-lg"
          style={{ top: 'calc(env(safe-area-inset-top, 0) + 6px)' }}
          aria-label="Open sidebar"
          title="Menu"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Desktop-only reopen chevron — visible whenever the sidebar is
          collapsed (works in every section, not just chat/tools/links). */}
      {sidebarCollapsed && !pathname.startsWith('/hub/home') && (
        <button
          onClick={toggleSidebarCollapsed}
          className="hidden md:flex fixed left-16 top-1/2 -translate-y-1/2 z-30 items-center justify-center w-5 h-12 bg-[#1A3D5C] hover:bg-[#22506F] border-y border-r border-white/10 rounded-r text-white/80 hover:text-white transition-colors"
          aria-label="Show sidebar"
          title="Show sidebar"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile safe-area-top spacer — there is no top chrome anymore, so
            content would otherwise bleed under the iOS notch / Dynamic Island. */}
        <div
          className="md:hidden flex-none"
          style={{ height: 'env(safe-area-inset-top, 0)' }}
          aria-hidden="true"
        />

        {/* Desktop Dialer Control S1: persistent global call bar with inline
            controls (Mute / Hold / Transfer / End) + expand-to-full-dialer.
            No-ops when no provider context, no in-progress call, or on
            /hub/dialer. Supersedes the navigate-only Session 58.5 banner. */}
        <GlobalCallBar />

        {/* Announcement ticker — Hub-section paths only. */}
        {activeRail === 'hub' && !pathname.startsWith('/hub/home') && (
          <AnnouncementTicker
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            initialActive={initialActiveAnnouncements ?? []}
          />
        )}

        <div
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
          style={{
            // Mobile: leave room for the bottom tab bar (~56px + safe area).
            // Desktop: no bottom bar, no padding — otherwise the composer
            // would have a huge gap below it.
            paddingBottom: isMobile
              ? (keyboardOpen ? 'env(safe-area-inset-bottom, 0)' : 'calc(env(safe-area-inset-bottom, 0) + 56px)')
              : 0,
          }}
        >
          {children}
        </div>
      </div>

      <HubMobileBar
        onMoreClick={() => setShowMobileMore(true)}
        onHubClick={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        onTxtClick={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        onPhoneClick={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        onUserSlotNav={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        onTimeClockClick={() => setShowTimeClock(true)}
        onToolsClick={() => { setManualRail('tools'); setMobileDrawerOpen(true) }}
        onLinksClick={() => { setManualRail('links'); setMobileDrawerOpen(true) }}
        onToggleDnd={toggleDnd}
        isClockedIn={isClockedIn}
        unreadHub={unreadHub}
        unheardVoicemails={unheardVoicemails}
        txtUnread={txtUnread}
        missedCall={missedCall}
        dailyLogUnread={dailyLogUnread}
        permissions={permissions}
        items={liveLayout.items}
        rooms={rooms}
        conversations={railConversations}
        currentUserStatus={liveStatus}
        hidden={keyboardOpen}
        drawerOpen={mobileDrawerOpen}
        activeManualRail={manualRail}
        onCloseDrawer={closeMobileDrawer}
      />
    </div>

    {showCompose && (
      <HubQuickCompose
        onClose={() => setShowCompose(false)}
        rooms={rooms}
        hubUsers={hubUsers}
        currentUserId={currentUserId}
        conversations={railConversations}
        onConversationCreated={handleConversationCreated}
      />
    )}
    {showTimeClock && (
      <TimesheetClockModal
        onClose={() => { setShowTimeClock(false); refreshClockedIn() }}
      />
    )}
    {showNotifPrefs && <NotifPrefsModal onClose={() => setShowNotifPrefs(false)} />}
    {showMobileMore && (
      <HubMobileMore
        onClose={() => setShowMobileMore(false)}
        showAdmin={showAdminRail}
        unreadActivity={unreadActivity}
        onSearchClick={() => { setShowMobileMore(false); setShowCompose(true) }}
        onToolsClick={() => { setShowMobileMore(false); setManualRail('tools'); setMobileDrawerOpen(true) }}
        onLinksClick={() => { setShowMobileMore(false); setManualRail('links'); setMobileDrawerOpen(true) }}
        onProfileClick={() => { setShowMobileMore(false); setManualRail('profile'); setMobileDrawerOpen(true) }}
        onActivityClick={() => { setShowMobileMore(false); setShowActivity(true) }}
        onTimeClockClick={() => { setShowMobileMore(false); setShowTimeClock(true) }}
        onToggleDnd={toggleDnd}
        onOpenLayoutEditor={() => { setShowMobileMore(false); setShowLayoutEditor(true) }}
        permissions={permissions}
        items={liveLayout.items}
        rooms={rooms}
        conversations={railConversations}
        currentUserId={currentUserId}
        currentUserStatus={liveStatus}
      />
    )}
    {showDesktopLauncher && (
      <AppLauncherPanel
        items={liveLayout.items}
        permissions={permissions}
        rooms={rooms}
        conversations={railConversations}
        currentUserId={currentUserId}
        onOpenLayoutEditor={() => { setShowDesktopLauncher(false); setShowLayoutEditor(true) }}
        onClose={() => setShowDesktopLauncher(false)}
        onSearch={() => { setShowDesktopLauncher(false); setShowCompose(true) }}
        onActivity={() => { setShowDesktopLauncher(false); setShowActivity(true) }}
        onProfile={() => { setShowDesktopLauncher(false); setManualRail('profile'); openSidebar() }}
        onTools={() => { setShowDesktopLauncher(false); setManualRail('tools'); openSidebar() }}
        onLinks={() => { setShowDesktopLauncher(false); setManualRail('links'); openSidebar() }}
        onTimeClock={() => { setShowDesktopLauncher(false); setShowTimeClock(true) }}
        onToggleDnd={toggleDnd}
        currentUserStatus={liveStatus}
        showAdmin={showAdminRail}
      />
    )}
    {showLayoutEditor && (
      <LayoutEditor
        layout={liveLayout}
        permissions={permissions}
        rooms={rooms}
        conversations={railConversations}
        currentUserId={currentUserId}
        onChange={saveLayout}
        onClose={() => setShowLayoutEditor(false)}
      />
    )}
    <HubActivityPanel open={showActivity} onClose={() => setShowActivity(false)} />
    </HubTextSizeContext.Provider>
  )

  // OnCallPresenceProvider wraps the shell so the purple "on a call" dot works
  // for everyone: dialer users (mounted inside DialerProvider, so it reads the
  // shared call state and tracks themselves) AND non-dialer users (no device —
  // they only observe teammates' dots).
  const withPresence = (
    <OnCallPresenceProvider companyId={companyId} currentUserId={currentUserId}>
      {shell}
    </OnCallPresenceProvider>
  )

  // Lift the Twilio Voice Device + IncomingCall overlay to shell level when
  // the user has dialer access AND hasn't opted out via Settings. Anyone else
  // gets the original Session 56 behavior: Device only registers when
  // DialerPanel mounts on /hub/dialer.
  return liftDialerDevice ? <DialerProvider>{withPresence}</DialerProvider> : withPresence
}
