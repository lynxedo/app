'use client'

import { useEffect, useState } from 'react'
import ActivityFeed from '@/app/hub/activity/ActivityFeed'

// Floating bell that lives in the top-right corner of the main Hub content
// area. Shows the unread mention/reply count as a small badge; clicking
// opens a slide-in panel that renders the existing ActivityFeed.
export default function HubActivityBell({ unreadCount }: { unreadCount: number }) {
  const [open, setOpen] = useState(false)

  // Close on Escape when the panel is open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed z-30 right-3 top-3 md:right-4 md:top-4 w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-gray-900/80 hover:bg-gray-800 border border-white/10 text-white/80 hover:text-white backdrop-blur-sm shadow-lg transition-colors"
        style={{ top: 'calc(env(safe-area-inset-top, 0) + 0.75rem)' }}
        title="Activity"
        aria-label={unreadCount > 0 ? `Activity — ${unreadCount} unread` : 'Activity'}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-gray-950">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40 md:bg-black/30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Slide-in panel */}
          <aside
            className="fixed top-0 right-0 bottom-0 z-50 w-full md:w-[420px] bg-gray-950 border-l border-gray-800 shadow-2xl flex flex-col"
            style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
            role="dialog"
            aria-label="Activity panel"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h2 className="text-base font-bold text-white">Activity</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-white/50 hover:text-white p-1.5 rounded"
                aria-label="Close"
              >
                ✕
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <ActivityFeed />
            </div>
          </aside>
        </>
      )}
    </>
  )
}
