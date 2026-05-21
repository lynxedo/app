'use client'

import { useState, useEffect, useCallback } from 'react'
import HubSidebar from './HubSidebar'
import AnnouncementTicker, { type Announcement } from './AnnouncementTicker'
import HubQuickCompose from './HubQuickCompose'
import TimesheetClockModal from './TimesheetClockModal'
import { HubTextSizeContext } from './HubTextSizeContext'
import type { HubUser } from './MessageFeed'

type Room = { id: string; name: string; is_private: boolean }

// Exposed so HubSidebar can call it from a custom event
export const HUB_CONV_CREATED_EVENT = 'hub-conversation-created'

export default function HubShell({
  rooms,
  userEmail,
  currentUserId,
  hubUsers,
  currentUserStatus,
  currentUserDisplayName,
  isAdmin,
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
  children,
}: {
  rooms: Room[]
  userEmail: string
  currentUserId: string
  hubUsers: HubUser[]
  currentUserStatus?: string | null
  currentUserDisplayName?: string
  isAdmin?: boolean
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
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [showTimeClock, setShowTimeClock] = useState(false)
  const [textSize, setTextSize] = useState(initialTextSize ?? 'default')

  // Desktop-only sidebar collapse, persisted across reloads via localStorage.
  // Mobile uses the existing sidebarOpen drawer; this flag is `md:`-only.
  useEffect(() => {
    try {
      setDesktopCollapsed(localStorage.getItem('hub-sidebar-collapsed') === '1')
    } catch {}
  }, [])
  const toggleDesktopCollapsed = useCallback(() => {
    setDesktopCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('hub-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('hub-text-size', initialTextSize ?? 'default')
  }, [initialTextSize])

  // Keep <html> class in sync with the user's selection so platform-wide
  // root font-size scaling (defined in globals.css) reflects S/M/L changes
  // without a full reload. Server already sets the initial class from the
  // user's profile in app/layout.tsx.
  useEffect(() => {
    const html = document.documentElement
    html.classList.remove('text-size-small', 'text-size-default', 'text-size-large')
    html.classList.add(`text-size-${textSize}`)
  }, [textSize])

  // Track Visual Viewport offset so the position:fixed mobile top bar can
  // follow the visible area on iOS Safari. iOS otherwise scrolls the layout
  // viewport when the composer textarea is focused, dragging fixed elements
  // along with it. We expose --vv-top as a CSS variable and apply it as
  // `top` on the mobile top bar.
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

  return (
    <HubTextSizeContext.Provider value={textSize}>
    <div className="flex h-[100dvh] bg-gray-950 text-white overflow-hidden">
      {/* Mobile sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — drawer on mobile, in-flow column on desktop (hidden when
          desktopCollapsed). */}
      <div className={`
        fixed inset-y-0 left-0 z-50 md:relative md:z-auto
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        ${desktopCollapsed ? 'md:hidden' : ''}
      `}>
        <HubSidebar
          rooms={rooms}
          userEmail={userEmail}
          currentUserId={currentUserId}
          hubUsers={hubUsers}
          currentUserStatus={currentUserStatus}
          currentUserDisplayName={currentUserDisplayName}
          isAdmin={isAdmin}
          onClose={() => setSidebarOpen(false)}
          onDesktopCollapse={toggleDesktopCollapsed}
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
          onOpenTimeClock={() => { setSidebarOpen(false); setShowTimeClock(true) }}
        />
      </div>

      {/* Desktop-only reopen chevron — visible only when the desktop sidebar
          is collapsed. Sits flush against the left edge of the main column. */}
      {desktopCollapsed && (
        <button
          onClick={toggleDesktopCollapsed}
          className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-30 items-center justify-center w-6 h-16 bg-[#1A3D5C] hover:bg-[#22506F] border-y border-r border-white/10 rounded-r text-white/80 hover:text-white transition-colors"
          aria-label="Show sidebar"
          title="Show sidebar"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar — fixed to the viewport so it stays visible when iOS
            Safari auto-scrolls the document on textarea focus. A flex-none
            spacer below preserves the column layout. */}
        <div
          className="fixed left-0 right-0 z-30 md:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950"
          style={{
            top: 'var(--vv-top, 0px)',
            paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
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
            aria-label="New message"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>

        {/* Spacer pushing flow content below the fixed top bar. The bar's
            icons (h-6 = 1.5rem) scale with the S/M/L root font-size, so
            this height must be rem-based — a fixed px constant gets
            overtaken at L and the announcement ticker ends up partly
            hidden behind the bar.

            Bar height: env(safe-area-inset-top) + 12px (padding-top,
            inline) + 1.5rem (h-6 button icons) + 12px (py-3 bottom) +
            1px (border-b) ≈ safe + 25px + 1.5rem. Add ~12px buffer. */}
        <div
          className="flex-none md:hidden"
          style={{ height: 'calc(env(safe-area-inset-top) + 1.5rem + 37px)' }}
          aria-hidden="true"
        />

        <AnnouncementTicker
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          initialActive={initialActiveAnnouncements ?? []}
        />
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {children}
        </div>
      </div>

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
    </HubTextSizeContext.Provider>
  )
}
