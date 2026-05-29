'use client'

import SidebarShell, { SidebarLinkRow } from './SidebarShell'

export default function AdminSidebar({
  grants,
  isSuperAdmin,
  onClose,
  onDesktopCollapse,
}: {
  grants: {
    people: boolean
    hub: boolean
    routing: boolean
    timesheet: boolean
    fleet: boolean
    daily_log: boolean
    forms: boolean
  }
  isSuperAdmin: boolean
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  return (
    <SidebarShell title="Admin" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      {(isSuperAdmin || grants.people) && (
        <SidebarLinkRow href="/hub/admin" icon="👥" label="People" onClose={onClose} />
      )}
      {(isSuperAdmin || grants.hub) && (
        <SidebarLinkRow href="/hub/admin/hub" icon="💬" label="Hub" prefixMatch onClose={onClose} />
      )}
      {(isSuperAdmin || grants.routing) && (
        <SidebarLinkRow href="/hub/admin/routing" icon="⚡" label="Routing" prefixMatch onClose={onClose} />
      )}
      {(isSuperAdmin || grants.timesheet) && (
        <SidebarLinkRow href="/hub/admin/timesheet" icon="🕐" label="Time Records" prefixMatch onClose={onClose} />
      )}
      {(isSuperAdmin || grants.fleet) && (
        <SidebarLinkRow href="/hub/admin/fleet" icon="🚛" label="Fleet" prefixMatch onClose={onClose} />
      )}
      {(isSuperAdmin || grants.daily_log) && (
        <SidebarLinkRow href="/hub/admin/daily-log" icon="📋" label="Daily Log" prefixMatch onClose={onClose} />
      )}
      {(isSuperAdmin || grants.forms) && (
        <SidebarLinkRow href="/hub/admin/forms" icon="📝" label="Form Builder" prefixMatch onClose={onClose} />
      )}
    </SidebarShell>
  )
}
