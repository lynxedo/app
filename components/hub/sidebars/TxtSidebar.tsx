'use client'

import ClientsSidebar from '../ClientsSidebar'
import { SidebarHeader } from './SidebarShell'

export default function TxtSidebar({ onClose, onDesktopCollapse }: { onClose?: () => void; onDesktopCollapse?: () => void }) {
  return (
    <aside
      className="h-full w-72 bg-[var(--t-panel)] text-white flex flex-col flex-none border-r border-white/5 min-h-0"
      aria-label="Client texts sidebar"
    >
      <SidebarHeader title="Client Texts" onClose={onClose} onDesktopCollapse={onDesktopCollapse} />
      <ClientsSidebar onClose={onClose} />
    </aside>
  )
}
