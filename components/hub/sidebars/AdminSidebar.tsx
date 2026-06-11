'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SidebarShell from './SidebarShell'
import { CatalogIcon, type CatalogId } from '../railCatalog'

// Single admin nav row — renders the catalog SVG glyph + a label, matching the
// Tools/Hub sidebar link rows. Replaces the old emoji-based SidebarLinkRow.
function AdminRow({
  href,
  iconId,
  label,
  exact,
  onClose,
}: {
  href: string
  iconId: CatalogId
  label: string
  exact?: boolean
  onClose?: () => void
}) {
  const pathname = usePathname() ?? ''
  // prefixMatch needs the trailing '/' so /hub/admin/daily-log doesn't
  // false-match a sibling like /hub/admin/daily-log-v2.
  const isActive = exact
    ? pathname === href
    : (pathname === href || pathname.startsWith(href + '/'))
  return (
    <Link
      href={href}
      onClick={() => onClose?.()}
      className={`flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-lg text-lg md:text-sm transition-colors ${
        isActive
          ? 'bg-sky-500/[0.16] text-white font-semibold ring-1 ring-inset ring-sky-400/30'
          : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <span className="text-white/70 flex-none w-5 h-5 flex items-center justify-center">
        <CatalogIcon id={iconId} />
      </span>
      <span className="truncate flex-1">{label}</span>
    </Link>
  )
}

export default function AdminSidebar({
  grants,
  isSuperAdmin,
  onClose,
  onDesktopCollapse,
}: {
  grants: {
    people: boolean
    hub: boolean
    guardian?: boolean
    txt?: boolean
    announcements?: boolean
    file_tags?: boolean
    routing: boolean
    timesheet: boolean
    fleet: boolean
    daily_log: boolean
    zone_sizer: boolean
    dialer: boolean
    contacts: boolean
    products: boolean
    forms: boolean
  }
  isSuperAdmin: boolean
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  const show = (grant: boolean) => isSuperAdmin || grant
  return (
    <SidebarShell title="Admin" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      {show(grants.people) && (
        <AdminRow href="/hub/admin" iconId="people" label="People" exact onClose={onClose} />
      )}
      {show(grants.hub) && (
        <AdminRow href="/hub/admin/hub" iconId="hub" label="Hub" onClose={onClose} />
      )}
      {show(!!(grants.guardian ?? grants.hub)) && (
        <AdminRow href="/hub/admin/guardian" iconId="guardian" label="Guardian" onClose={onClose} />
      )}
      {show(!!(grants.txt ?? grants.hub)) && (
        <AdminRow href="/hub/admin/txt" iconId="txt2" label="Txt" onClose={onClose} />
      )}
      {show(!!(grants.announcements ?? grants.hub)) && (
        <AdminRow href="/hub/admin/announcements" iconId="announcements" label="Announcements" onClose={onClose} />
      )}
      {show(grants.contacts) && (
        <AdminRow href="/hub/admin/contacts" iconId="contacts" label="Contacts" onClose={onClose} />
      )}
      {show(grants.routing) && (
        <AdminRow href="/hub/admin/routing" iconId="routing" label="Routing" onClose={onClose} />
      )}
      {show(grants.timesheet) && (
        <AdminRow href="/hub/admin/timesheet" iconId="time-records" label="Time Records" onClose={onClose} />
      )}
      {show(grants.fleet) && (
        <AdminRow href="/hub/admin/fleet" iconId="fleet" label="Fleet" onClose={onClose} />
      )}
      {show(grants.daily_log) && (
        <AdminRow href="/hub/admin/daily-log" iconId="daily-log" label="Daily Log" onClose={onClose} />
      )}
      {show(grants.products) && (
        <AdminRow href="/hub/admin/products" iconId="products" label="Products" onClose={onClose} />
      )}
      {show(grants.zone_sizer) && (
        <AdminRow href="/hub/admin/zone-sizer" iconId="zone-sizer" label="Zone Sizer" onClose={onClose} />
      )}
      {show(grants.dialer) && (
        <AdminRow href="/hub/admin/dialer" iconId="dialer" label="Dialer" onClose={onClose} />
      )}
      {show(!!(grants.file_tags ?? grants.hub)) && (
        <AdminRow href="/hub/admin/file-tags" iconId="file-tags" label="File Tags" onClose={onClose} />
      )}
      {show(grants.forms) && (
        <AdminRow href="/hub/admin/forms" iconId="forms" label="Form Builder" onClose={onClose} />
      )}
    </SidebarShell>
  )
}
