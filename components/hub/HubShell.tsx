'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import HubSidebar from './HubSidebar'
import HubRail, { railFromPath } from './HubRail'
import HubMobileBar from './HubMobileBar'
import HubMobileMore from './HubMobileMore'
import HubActivityPanel from './HubActivityBell'
import ToolsSidebar from './sidebars/ToolsSidebar'
import LinksSidebar from './sidebars/LinksSidebar'
import AdminSidebar from './sidebars/AdminSidebar'
import SettingsSidebar from './sidebars/SettingsSidebar'
import ProfileSidebar from './sidebars/ProfileSidebar'
import ActivitySidebar from './sidebars/ActivitySidebar'
import TxtSidebar from './sidebars/TxtSidebar'
import AnnouncementTicker, { type Announcement } from './AnnouncementTicker'
import HubQuickCompose from './HubQuickCompose'
import TimesheetClockModal from './TimesheetClockModal'
import NotifPrefsModal from './NotifPrefsModal'
import { HubTextSizeContext } from './HubTextSizeContext'
import type { HubUser } from './MessageFeed'
import type { RailConfig, RailPermissions } from './railCatalog'

type Room = { id: string; name: string; is_private: boolean }

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
  initialRailConfig,
  canAccessTracker,
  canAccessCallLog,
  canAccessLawn,
  canAccessTimesheet,
  canAccessRouting,
  canAccessBooks,
  canAccessFleet,
  canAccessZoneSizer,
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
  }
  initialActiveAnnouncements?: Announcement[]
  initialTextSize?: string
  initialPinnedIds?: string[]
  initialIsClockedIn?: boolean
  initialRailConfig?: RailConfig | null
  canAccessTracker?: boolean
  canAccessCallLog?: boolean
  canAccessLawn?: boolean
  canAccessTimesheet?: boolean
  canAccessRouting?: boolean
  canAccessBooks?: boolean
  canAccessFleet?: boolean
  canAccessZoneSizer?: boolean
  myPresenceMode?: 'clock' | 'activity'
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ''
  const pathRail = railFromPath(pathname)

  const [manualRail, setManualRail] = useState<ManualRail>(null)
  useEffect(() => { setManualRail(null) }, [pathname])

  const activeRail = manualRail ?? pathRail

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [showMobileMore, setShowMobileMore] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [showTimeClock, setShowTimeClock] = useState(false)
  const [showNotifPrefs, setShowNotifPrefs] = useState(false)
  const [textSize, setTextSize] = useState(initialTextSize ?? 'default')
  const [liveStatus, setLiveStatus] = useState<string | null>(currentUserStatus ?? null)
  const [unreadActivity, setUnreadActivity] = useState<number>(0)
  const [unreadHub, setUnreadHub] = useState<boolean>(false)
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

  // Any-unread-DM/room poll for the Hub rail icon dot. Reads the same
  // read-receipts endpoint the sidebar uses; we just collapse to a boolean.
  useEffect(() => {
    let cancelled = false
    function tick() {
      fetch('/api/hub/read-receipts', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : { unread_room_ids: [], unread_conv_ids: [] })
        .then(d => {
          if (cancelled) return
          const any =
            (Array.isArray(d.unread_room_ids) && d.unread_room_ids.length > 0) ||
            (Array.isArray(d.unread_conv_ids) && d.unread_conv_ids.length > 0)
          setUnreadHub(any)
        })
        .catch(() => {})
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [pathname])

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

  const grants = adminGrants ?? {
    people: !!isAdmin, hub: !!isAdmin, routing: !!isAdmin,
    timesheet: !!isAdmin, fleet: !!isAdmin, daily_log: !!isAdmin, zone_sizer: !!isAdmin,
  }
  const isSuperAdmin = !!isAdmin
  const showAdminRail =
    isSuperAdmin || grants.people || grants.hub || grants.routing ||
    grants.timesheet || grants.fleet || grants.daily_log || grants.zone_sizer

  const permissions: RailPermissions = {
    isAdmin: !!isAdmin,
    canAccessTracker: !!canAccessTracker,
    canAccessRouting: !!canAccessRouting,
    canAccessFleet: !!canAccessFleet,
    canAccessBooks: !!canAccessBooks,
    canAccessLawn: !!canAccessLawn,
    canAccessCallLog: !!canAccessCallLog,
    canAccessTimesheet: !!canAccessTimesheet,
    canAccessZoneSizer: !!canAccessZoneSizer,
  }

  function renderSidebar() {
    const collapseProps = { onDesktopCollapse: toggleSidebarCollapsed }
    switch (activeRail) {
      case 'txt':
        return <TxtSidebar onClose={closeMobileDrawer} {...collapseProps} />
      case 'tools':
        return (
          <ToolsSidebar
            isAdmin={!!isAdmin}
            canAccessRouting={!!canAccessRouting}
            canAccessTracker={!!canAccessTracker}
            canAccessLawn={!!canAccessLawn}
            canAccessZoneSizer={!!canAccessZoneSizer}
            canAccessCallLog={!!canAccessCallLog}
            canAccessBooks={!!canAccessBooks}
            canAccessFleet={!!canAccessFleet}
            canAccessTimesheet={!!canAccessTimesheet}
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
            canAccessTimesheet={canAccessTimesheet}
            canAccessRouting={canAccessRouting}
            canAccessBooks={canAccessBooks}
            canAccessFleet={canAccessFleet}
            myPresenceMode={myPresenceMode}
            onOpenTimeClock={() => { closeMobileDrawer(); setShowTimeClock(true) }}
          />
        )
    }
  }

  // Landing page has no useful sidebar — hide the in-flow sidebar there.
  // Otherwise show unless explicitly collapsed.
  const hideSidebarDesktop = pathname.startsWith('/hub/home') || sidebarCollapsed


  return (
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
        isClockedIn={isClockedIn}
        onSearchClick={() => setShowCompose(true)}
        onProfileClick={() => setManualRail('profile')}
        onToolsClick={() => setManualRail('tools')}
        onLinksClick={() => setManualRail('links')}
        onTimeClockClick={() => setShowTimeClock(true)}
        onActivityClick={() => setShowActivity(true)}
        currentUserId={currentUserId}
        currentUserDisplayName={currentUserDisplayName}
        currentUserAvatarUrl={currentUserAvatarUrl ?? null}
        currentUserStatus={liveStatus}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        permissions={permissions}
        railConfig={initialRailConfig ?? null}
      />

      <div
        className={`
          fixed top-0 left-0 z-50 md:relative md:z-auto md:inset-y-0 md:bottom-auto
          transform transition-transform duration-200 ease-in-out
          ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          ${hideSidebarDesktop ? 'md:hidden' : ''}
        `}
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 56px)' }}
      >
        {renderSidebar()}
      </div>

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

      {/* Mobile floating + (Quick Compose / Search) */}
      {!keyboardOpen && pathname.startsWith('/hub') && (
        <button
          type="button"
          onClick={() => setShowCompose(true)}
          className="md:hidden fixed right-3 bottom-[68px] z-30 w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-400 text-white flex items-center justify-center shadow-lg transition-colors"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 68px)' }}
          aria-label="Quick compose / search"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      <HubMobileBar
        onMoreClick={() => setShowMobileMore(true)}
        onHubClick={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        onTimeClockClick={() => setShowTimeClock(true)}
        onToolsClick={() => { setManualRail('tools'); setMobileDrawerOpen(true) }}
        onLinksClick={() => { setManualRail('links'); setMobileDrawerOpen(true) }}
        isClockedIn={isClockedIn}
        unreadHub={unreadHub}
        permissions={permissions}
        railConfig={initialRailConfig ?? null}
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
      />
    )}
    <HubActivityPanel open={showActivity} onClose={() => setShowActivity(false)} />
    </HubTextSizeContext.Provider>
  )
}
