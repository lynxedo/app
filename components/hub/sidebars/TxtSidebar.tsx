'use client'

import ClientsSidebar from '../ClientsSidebar'
import { SidebarHeader } from './SidebarShell'

export default function TxtSidebar({ onClose }: { onClose?: () => void }) {
  return (
    <aside
      className="h-full w-72 bg-[#0F2E47] text-white flex flex-col flex-none border-r border-white/5"
      aria-label="Client texts sidebar"
    >
      <SidebarHeader title="Client Texts" />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ClientsSidebar onClose={onClose} />
      </div>
    </aside>
  )
}
