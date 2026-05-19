'use client'

import { useState, useEffect, useCallback } from 'react'
import HubSidebar from './HubSidebar'
import AnnouncementTicker from './AnnouncementTicker'
import HubQuickCompose from './HubQuickCompose'
import TimesheetClockModal from './TimesheetClockModal'
import { HubTextSizeContext } from './HubTextSizeContext'
import type { HubUser } from './MessageFeed'

type Room = { id: string; name: string; is_private: boolean }
type InitialAnnouncement = { id: string; content: string; expires_at: string; reactions: Array<{ announcement_id: string; user_id: string; emoji: string }> } | null

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
  initialAnnouncement,
  initialTextSize,
  initialPinnedIds,
  canAccessTracker,
  canAccessCallLog,
  canAccessLawn,
  canAccessTimesheet,
  children,
}: {
  rooms: Room[]
  userEmail: string
  currentUserId: string
  hubUsers: HubUser[]
  currentUserStatus?: string | null
  currentUserDisplayName?: string
  isAdmin?: boolean
  initialAnnouncement?: InitialAnnouncement
  initialTextSize?: string
  initialPinnedIds?: string[]
  canAccessTracker?: boolean
  canAccessCallLog?: boolean
  canAccessLawn?: boolean
  canAccessTimesheet?: boolean
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [showTimeClock, setShowTimeClock] = useState(false)
  const [textSize, setTextSize] = useState(initialTextSize ?? 'default')

  useEffect(() => {
    localStorage.setItem('hub-text-size', initialTextSize ?? 'default')
  }, [initialTextSize])

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

      {/* Sidebar — always visible on md+, drawer on mobile */}
      <div className={`
        fixed inset-y-0 left-0 z-50 md:relative md:z-auto
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
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
          textSize={textSize}
          onTextSizeChange={setTextSize}
          initialPinnedIds={initialPinnedIds ?? []}
          canAccessTracker={canAccessTracker}
          canAccessCallLog={canAccessCallLog}
          canAccessLawn={canAccessLawn}
          canAccessTimesheet={canAccessTimesheet}
          onOpenTimeClock={() => { setSidebarOpen(false); setShowTimeClock(true) }}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar with hamburger */}
        <div className="flex-none flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 md:hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-white transition-colors p-1 -ml-1 rounded hover:bg-gray-800"
            aria-label="Open sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-white flex-1">Heroes Lawn Care</span>
          <button
            onClick={() => setShowCompose(true)}
            className="text-gray-400 hover:text-white transition-colors p-1 -mr-1 rounded hover:bg-gray-800"
            aria-label="New message"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>

        <AnnouncementTicker currentUserId={currentUserId} initialAnnouncement={initialAnnouncement ?? null} />
        {children}
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
