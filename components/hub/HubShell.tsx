'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import HubSidebar from './HubSidebar'
import HubRail, { railFromPath } from './HubRail'
import HubMobileBar from './HubMobileBar'
import HubMobileMore from './HubMobileMore'
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

type Room = { id: string; name: string; is_private: boolean }

// Exposed so HubSidebar can call it from a custom event
export const HUB_CONV_CREATED_EVENT = 'hub-conversation-created'

type ManualRail = 'tools' | 'links' | 'profile' | null

export default function HubShell({
  rooms,
  userEmail,
  currentUserId,
  hubUsers,
  currentUserStatus,
  currentUserDisplayName,
  isAdmin,
  adminGrants,
  initialActiveAnnouncements,
  initialTextSize,
  initialPinnedIds,
  canAccessTracker,
  canAccessCallLog,
  canAccessLawn,
  canAccessTimesheet,
  canAccessRouting,
  canAccessBooks,
  canAccessFleet,
  myPresenceMode,
  children,
}: {
  rooms: Room[]
  userEmail: string
  currentUserId: string
  hubUsers: HubUser[]
  currentUserStatus?: string | null
  currentUserDisplayName?: string
  isAdmin?: boolean
  adminGrants?: {
    people: boolean
    hub: boolean
    routing: boolean
    timesheet: boolean
    fleet: boolean
    daily_log: boolean
  }
  initialActiveAnnouncements?: Announcement[]
  initialTextSize?: string
  initialPinnedIds?: string[]
  canAccessTracker?: boolean
  canAccessCallLog?: boolean
  canAccessLawn?: boolean
  canAccessTimesheet?: boolean
  canAccessRouting?: boolean
  canAccessBooks?: boolean
  canAccessFleet?: boolean
  myPresenceMode?: 'clock' | 'activity'
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ''
  const pathRail = railFromPath(pathname)

  // Manual rail overrides the path-derived rail for rail icons that don't have
  // their own URL (Tools, Links, Profile). Cleared when the path changes back
  // to a different rail.
  const [manualRail, setManualRail] = useState<ManualRail>(null)
  useEffect(() => {
    // Whenever the path changes, drop any manual override so the active rail
    // reflects the URL again.
    setManualRail(null)
  }, [pathname])

  const activeRail: ReturnType<typeof railFromPath> = manualRail ?? pathRail

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [showMobileMore, setShowMobileMore] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [showTimeClock, setShowTimeClock] = useState(false)
  const [showNotifPrefs, setShowNotifPrefs] = useState(false)
  const [textSize, setTextSize] = useState(initialTextSize ?? 'default')
  const [liveStatus, setLiveStatus] = useState<string | null>(currentUserStatus ?? null)
  const [unreadActivity, setUnreadActivity] = useState<number>(0)

  // Poll the activity unread count. Resets to 0 when the user opens /hub/activity
  // (the page's POST /api/hub/activity stamps last_activity_seen_at). 90s poll
  // keeps it lightweight; the badge is best-effort, not real-time.
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

  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem('hub-sidebar-collapsed') === '1')
    } catch {}
  }, [])
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('hub-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }, [])

  // Remember last chat path for the rail's "Chat" icon to jump back to.
  useEffect(() => {
    if (pathRail === 'chat' && pathname.startsWith('/hub')) {
      try { localStorage.setItem('hub_last_chat_route', pathname) } catch {}
    }
  }, [pathname, pathRail])

  // Keep <html> class in sync with the user's selection so platform-wide
  // root font-size scaling reflects S/M/L changes without a full reload.
  useEffect(() => {
    const html = document.documentElement
    html.classList.remove('text-size-small', 'text-size-default', 'text-size-large')
    html.classList.add(`text-size-${textSize}`)
  }, [textSize])

  // Track Visual Viewport offset so the position:fixed mobile top bar can
  // follow the visible area on iOS Safari.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    function update() {
      document.documentElement.style.setProperty('--vv-top', `${vv!.offsetTop}px`)
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

  // Cmd+K / Ctrl+K opens Quick Compose
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

  const handleConversationCreated = useCallback(() => {
    window.dispatchEvent(new CustomEvent(HUB_CONV_CREATED_EVENT))
  }, [])

  const closeMobileDrawer = useCallback(() => setMobileDrawerOpen(false), [])

  const grants = adminGrants ?? {
    people: !!isAdmin, hub: !!isAdmin, routing: !!isAdmin,
    timesheet: !!isAdmin, fleet: !!isAdmin, daily_log: !!isAdmin,
  }
  const isSuperAdmin = !!isAdmin
  const showAdminRail =
    isSuperAdmin || grants.people || grants.hub || grants.routing ||
    grants.timesheet || grants.fleet || grants.daily_log

  // Pick the sidebar to render based on active rail.
  function renderSidebar() {
    switch (activeRail) {
      case 'chat':
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
            textSize={textSize}
            onTextSizeChange={setTextSize}
            initialPinnedIds={initialPinnedIds ?? []}
            canAccessTracker={canAccessTracker}
            canAccessCallLog={canAccessCallLog}
            canAccessLawn={canAccessLawn}
            canAccessTimesheet={canAccessTimesheet}
            canAccessRouting={canAccessRouting}
            canAccessBooks={canAccessBooks}
            canAccessFleet={canAccessFleet}
            myPresenceMode={myPresenceMode}
            onOpenTimeClock={() => { closeMobileDrawer(); setShowTimeClock(true) }}
          />
        )
      case 'txt':
        return <TxtSidebar onClose={closeMobileDrawer} />
      case 'tools':
        return (
          <ToolsSidebar
            isAdmin={!!isAdmin}
            canAccessRouting={!!canAccessRouting}
            canAccessTracker={!!canAccessTracker}
            canAccessLawn={!!canAccessLawn}
            canAccessCallLog={!!canAccessCallLog}
            canAccessBooks={!!canAccessBooks}
            canAccessFleet={!!canAccessFleet}
            canAccessTimesheet={!!canAccessTimesheet}
            onClose={closeMobileDrawer}
          />
        )
      case 'links':
        return <LinksSidebar onClose={closeMobileDrawer} />
      case 'activity':
        return <ActivitySidebar onClose={closeMobileDrawer} />
      case 'admin':
        return <AdminSidebar grants={grants} isSuperAdmin={isSuperAdmin} onClose={closeMobileDrawer} />
      case 'settings':
        return <SettingsSidebar onClose={closeMobileDrawer} />
      case 'profile':
        return (
          <ProfileSidebar
            displayName={currentUserDisplayName ?? userEmail.split('@')[0]}
            userEmail={userEmail}
            initialStatus={liveStatus}
            textSize={textSize}
            onTextSizeChange={setTextSize}
            onOpenNotifPrefs={() => setShowNotifPrefs(true)}
            onStatusChanged={s => setLiveStatus(s ?? null)}
            onClose={closeMobileDrawer}
          />
        )
      case 'home':
      default:
        // Home has no dedicated sidebar — render chat sidebar as a useful default.
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
            textSize={textSize}
            onTextSizeChange={setTextSize}
            initialPinnedIds={initialPinnedIds ?? []}
            canAccessTracker={canAccessTracker}
            canAccessCallLog={canAccessCallLog}
            canAccessLawn={canAccessLawn}
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

  // Hide the in-flow sidebar entirely on Home (no useful list) and on
  // collapsed-by-user state. Mobile drawer is independent.
  const hideSidebarDesktop = activeRail === 'home' || sidebarCollapsed

  return (
    <HubTextSizeContext.Provider value={textSize}>
    <div className="flex h-[100dvh] bg-gray-950 text-white overflow-hidden">
      {/* Mobile drawer backdrop */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={closeMobileDrawer}
        />
      )}

      {/* Desktop rail */}
      <HubRail
        showAdmin={showAdminRail}
        unreadActivity={unreadActivity}
        onSearchClick={() => setShowCompose(true)}
        onProfileClick={() => setManualRail('profile')}
        onToolsClick={() => setManualRail('tools')}
        onLinksClick={() => setManualRail('links')}
        currentUserDisplayName={currentUserDisplayName}
        currentUserStatus={liveStatus}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
      />

      {/* Sidebar — drawer on mobile, in-flow column on desktop. */}
      <div className={`
        fixed inset-y-0 left-0 z-50 md:relative md:z-auto
        transform transition-transform duration-200 ease-in-out
        ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        ${hideSidebarDesktop ? 'md:hidden' : ''}
      `}>
        {renderSidebar()}
      </div>

      {/* Desktop-only reopen chevron — visible only when the desktop sidebar
          is collapsed. */}
      {hideSidebarDesktop && activeRail !== 'home' && (
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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div
          className="fixed left-0 right-0 z-30 md:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950"
          style={{
            top: 'var(--vv-top, 0px)',
            paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
          }}
        >
          <button
            onClick={() => setMobileDrawerOpen(true)}
            className="text-gray-300 hover:text-white transition-colors p-1.5 -ml-1.5 rounded hover:bg-gray-800"
            aria-label="Open sidebar"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-base font-semibold text-white flex-1">Heroes Lawn Care</span>
          <button
            onClick={() => setShowCompose(true)}
            className="text-gray-300 hover:text-white transition-colors p-1.5 -mr-1.5 rounded hover:bg-gray-800"
            aria-label="Search / new message"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>

        {/* Spacer pushing flow content below the fixed top bar */}
        <div
          className="flex-none md:hidden"
          style={{ height: 'calc(env(safe-area-inset-top) + 1.5rem + 37px)' }}
          aria-hidden="true"
        />

        {/* Announcement ticker — Chat rail only, per spec */}
        {activeRail === 'chat' && (
          <AnnouncementTicker
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            initialActive={initialActiveAnnouncements ?? []}
          />
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col pb-[60px] md:pb-0">
          {children}
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <HubMobileBar
        onMoreClick={() => setShowMobileMore(true)}
        onChatClick={() => setMobileDrawerOpen(true)}
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
    {showTimeClock && <TimesheetClockModal onClose={() => setShowTimeClock(false)} />}
    {showNotifPrefs && <NotifPrefsModal onClose={() => setShowNotifPrefs(false)} />}
    {showMobileMore && (
      <HubMobileMore
        onClose={() => setShowMobileMore(false)}
        showAdmin={showAdminRail}
        onSearchClick={() => { setShowMobileMore(false); setShowCompose(true) }}
        onToolsClick={() => { setShowMobileMore(false); setManualRail('tools'); setMobileDrawerOpen(true) }}
        onLinksClick={() => { setShowMobileMore(false); setManualRail('links'); setMobileDrawerOpen(true) }}
        onProfileClick={() => { setShowMobileMore(false); setManualRail('profile'); setMobileDrawerOpen(true) }}
      />
    )}
    </HubTextSizeContext.Provider>
  )
}
