'use client'

import { useState, useEffect } from 'react'
import HubSidebar from './HubSidebar'
import AnnouncementTicker from './AnnouncementTicker'
import { HubTextSizeContext } from './HubTextSizeContext'
import type { HubUser } from './MessageFeed'

type Room = { id: string; name: string; is_private: boolean }
type InitialAnnouncement = { id: string; content: string; expires_at: string; reactions: Array<{ announcement_id: string; user_id: string; emoji: string }> } | null

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
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [textSize, setTextSize] = useState(initialTextSize ?? 'default')

  // Sync server-fetched preference to localStorage so MessageFeed can read it
  useEffect(() => {
    const size = initialTextSize ?? 'default'
    localStorage.setItem('hub-text-size', size)
    // Also fire the event so a mounted MessageFeed picks it up immediately
    window.dispatchEvent(new CustomEvent('hub-text-size-change', { detail: size }))
  }, [initialTextSize])

  return (
    <HubTextSizeContext.Provider value={textSize}>
    <div className="flex h-[100dvh] md:h-[calc(100dvh-3rem)] bg-gray-950 text-white overflow-hidden">
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
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden pb-16 md:pb-0">
        {/* Mobile top bar with hamburger */}
        <div className="flex-none flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-white transition-colors p-1 -ml-1 rounded hover:bg-gray-800"
            aria-label="Open sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-white">Heroes Lawn Care</span>
        </div>

        <AnnouncementTicker currentUserId={currentUserId} initialAnnouncement={initialAnnouncement ?? null} />
        {children}
      </div>
    </div>
    </HubTextSizeContext.Provider>
  )
}
