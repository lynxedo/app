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
  icon,
  label,
  exact,
  onClose,
}: {
  href: string
  iconId?: CatalogId
  // A custom glyph for rows without a catalog icon (e.g. Beta). Takes precedence.
  icon?: React.ReactNode
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
        {icon ?? (iconId ? <CatalogIcon id={iconId} /> : null)}
      </span>
      <span className="truncate flex-1">{label}</span>
    </Link>
  )
}

export default function AdminSidebar({
  grants,
  isSuperAdmin,
  isPlatformAdmin,
  onClose,
  onDesktopCollapse,
}: {
  grants: {
    people: boolean
    hub: boolean
    guardian?: boolean
    ai?: boolean
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
    integrations?: boolean
  }
  isSuperAdmin: boolean
  isPlatformAdmin?: boolean
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
      {show(!!(grants.ai ?? grants.guardian ?? grants.hub)) && (
        <AdminRow
          href="/hub/admin/ai"
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 13.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
            </svg>
          }
          label="AI"
          onClose={onClose}
        />
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
      {show(grants.products) && (
        <AdminRow href="/hub/admin/service-builder" iconId="products" label="Service Builder" onClose={onClose} />
      )}
      {show(grants.products) && (
        <AdminRow href="/hub/admin/service-mapping" iconId="products" label="Service Mapping" onClose={onClose} />
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
      {show(!!grants.integrations) && (
        <AdminRow
          href="/hub/admin/integrations"
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />
            </svg>
          }
          label="Integrations"
          onClose={onClose}
        />
      )}
      {isSuperAdmin && (
        <AdminRow href="/hub/admin/scoreboards" iconId="scoreboards" label="Scoreboards" onClose={onClose} />
      )}
      {isSuperAdmin && (
        <AdminRow
          href="/hub/admin/beta"
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3h6M10 3v5.5L5.2 17a2 2 0 001.8 3h10a2 2 0 001.8-3L14 8.5V3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14h9" />
            </svg>
          }
          label="Beta"
          onClose={onClose}
        />
      )}
      {isPlatformAdmin && (
        <AdminRow
          href="/hub/admin/platform"
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 9.5h17M3.5 14.5h17M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" />
            </svg>
          }
          label="Platform"
          onClose={onClose}
        />
      )}
    </SidebarShell>
  )
}
