'use client'

import SidebarShell, { SidebarLinkRow } from './SidebarShell'

export default function SettingsSidebar({ onClose }: { onClose?: () => void }) {
  return (
    <SidebarShell title="Settings" onClose={onClose}>
      <SidebarLinkRow href="/hub/settings" icon="👤" label="Profile" onClose={onClose} />
      <SidebarLinkRow href="/hub/settings#notifications" icon="🔔" label="Notifications" onClose={onClose} />
      <SidebarLinkRow href="/hub/settings#display" icon="🎨" label="Display" onClose={onClose} />
      <SidebarLinkRow href="/help" icon="❓" label="Help" onClose={onClose} />
    </SidebarShell>
  )
}
