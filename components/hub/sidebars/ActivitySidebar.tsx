'use client'

import SidebarShell from './SidebarShell'

export default function ActivitySidebar({ onClose, onDesktopCollapse }: { onClose?: () => void; onDesktopCollapse?: () => void }) {
  return (
    <SidebarShell title="Activity" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      <div className="px-2 text-xs text-white/50 leading-relaxed">
        Messages where you were <span className="text-amber-300">@mentioned</span> or replied to in a thread.
      </div>
      <button
        type="button"
        onClick={() => onClose?.()}
        className="hidden md:block w-full text-left px-2 py-2 md:py-1.5 rounded text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
      >
        All activity
      </button>
    </SidebarShell>
  )
}
