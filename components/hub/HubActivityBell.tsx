'use client'

import { useEffect } from 'react'
import ActivityFeed from '@/app/hub/activity/ActivityFeed'

// Controlled slide-in panel showing the Activity feed (mentions + thread
// replies). Opened from ProfileSidebar (desktop) and HubMobileMore (mobile).
// No floating bell button anymore — entry points live in menus.
export default function HubActivityPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  // Close on Escape when the panel is open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 md:bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
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
            onClick={onClose}
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
  )
}
