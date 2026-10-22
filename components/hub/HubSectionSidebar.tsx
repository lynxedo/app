'use client'

// The section sidebars (Dialer, Txt, Inbox, Scoreboards, Reports, Tracker,
// Marketing, Activity, Admin, Settings) — shared by the Hub window and by pages
// running inside Workspace Tabs (the embedded shell), so a page in a tab gets the
// same sidebar it has as a route. The Hub chat sidebar and the "You" panel stay in
// HubShell: they carry window-level state.

import AdminSidebar from './sidebars/AdminSidebar'
import SettingsSidebar from './sidebars/SettingsSidebar'
import ActivitySidebar from './sidebars/ActivitySidebar'
import TxtV2Sidebar from './sidebars/TxtV2Sidebar'
import EmailInboxSidebar from './sidebars/EmailInboxSidebar'
import DialerSidebar from './sidebars/DialerSidebar'
import ScoreboardsSidebar from './sidebars/ScoreboardsSidebar'
import ReportsSidebar from './sidebars/ReportsSidebar'
import TrackerSidebar from './sidebars/TrackerSidebar'
import MarketingSidebar from './sidebars/MarketingSidebar'
import type { RailId } from './HubRail'

export type AdminGrants = {
  people: boolean
  hub: boolean
  guardian: boolean
  ai: boolean
  txt: boolean
  announcements: boolean
  file_tags: boolean
  routing: boolean
  timesheet: boolean
  fleet: boolean
  daily_log: boolean
  dialer: boolean
  contacts: boolean
  products: boolean
  forms: boolean
  integrations: boolean
  quotes: boolean
}

export type RawAdminGrants = Partial<AdminGrants> & {
  people: boolean
  hub: boolean
  routing: boolean
  timesheet: boolean
  fleet: boolean
  daily_log: boolean
  dialer: boolean
}

/** Resolve the per-area Admin grants (missing ones follow isAdmin) + whether the Admin rail shows. */
export function resolveAdminGrants(adminGrants: RawAdminGrants | undefined, isAdmin: boolean): { grants: AdminGrants; showAdmin: boolean } {
  const raw = adminGrants ?? {
    people: isAdmin, hub: isAdmin, guardian: isAdmin, ai: isAdmin, txt: isAdmin,
    announcements: isAdmin, file_tags: isAdmin, routing: isAdmin,
    timesheet: isAdmin, fleet: isAdmin, daily_log: isAdmin,
    dialer: isAdmin, contacts: isAdmin, products: isAdmin, integrations: isAdmin,
  }
  const grants: AdminGrants = {
    people: !!raw.people,
    hub: !!raw.hub,
    guardian: !!(raw.guardian ?? isAdmin),
    ai: !!(raw.ai ?? isAdmin),
    txt: !!(raw.txt ?? isAdmin),
    announcements: !!(raw.announcements ?? isAdmin),
    file_tags: !!(raw.file_tags ?? isAdmin),
    routing: !!raw.routing,
    timesheet: !!raw.timesheet,
    fleet: !!raw.fleet,
    daily_log: !!raw.daily_log,
    dialer: !!raw.dialer,
    contacts: !!raw.contacts,
    products: !!raw.products,
    forms: !!(raw.forms ?? isAdmin),
    integrations: !!(raw.integrations ?? isAdmin),
    quotes: !!(raw.quotes ?? isAdmin),
  }
  const showAdmin = isAdmin || Object.values(grants).some(Boolean)
  return { grants, showAdmin }
}

/** Rails that have a sidebar of their own (everything else shows no sidebar in a tab). */
export const SECTION_SIDEBAR_RAILS: ReadonlySet<RailId> = new Set<RailId>([
  'dialer', 'txt2', 'email-inbox', 'scoreboards', 'reports', 'tracker', 'marketing', 'activity', 'admin', 'settings',
])

export type SectionSidebarProps = {
  rail: RailId
  onClose: () => void
  onDesktopCollapse: () => void
  isAdmin: boolean
  isPlatformAdmin?: boolean
  billingEnabled?: boolean
  grants: AdminGrants
  canAccessTxt: boolean
  canManageTxt: boolean
  canAccessDialer: boolean
  canAccessUnifiedInbox: boolean
  canAccessMarketing: boolean
  canAccessEmail: boolean
  canManageDrip: boolean
  canAdminMarketing: boolean
  canAdminEmail: boolean
  canAccessBeta: boolean
  currentUserId: string
  companyId: string
  scoreboardSlugs?: string[]
  reportSlugs: string[]
}

export default function HubSectionSidebar(p: SectionSidebarProps) {
  const collapseProps = { onDesktopCollapse: p.onDesktopCollapse }
  switch (p.rail) {
    case 'dialer':
      return <DialerSidebar onClose={p.onClose} canSeeAll={p.isAdmin || p.grants.dialer} canText={p.canAccessTxt} {...collapseProps} />
    case 'txt2':
      return (
        <TxtV2Sidebar
          onClose={p.onClose}
          {...collapseProps}
          canManage={p.canManageTxt}
          canCall={p.canAccessDialer}
          canAccessUnifiedInbox={p.canAccessUnifiedInbox}
          currentUserId={p.currentUserId}
          companyId={p.companyId}
        />
      )
    case 'email-inbox':
      return <EmailInboxSidebar onClose={p.onClose} {...collapseProps} currentUserId={p.currentUserId} companyId={p.companyId} />
    case 'scoreboards':
      return <ScoreboardsSidebar isAdmin={p.isAdmin} allowedSlugs={p.scoreboardSlugs} onClose={p.onClose} {...collapseProps} />
    case 'reports':
      return <ReportsSidebar visibleSlugs={p.reportSlugs} onClose={p.onClose} {...collapseProps} />
    case 'tracker':
      return <TrackerSidebar isAdmin={p.isAdmin} onClose={p.onClose} {...collapseProps} />
    case 'marketing':
      return (
        <MarketingSidebar
          isAdmin={p.isAdmin}
          canAccessMarketing={p.canAccessMarketing}
          canAccessEmail={p.canAccessEmail}
          canManageDrip={p.canManageDrip}
          canAdminMarketing={p.canAdminMarketing}
          canAdminEmail={p.canAdminEmail}
          onClose={p.onClose}
          {...collapseProps}
        />
      )
    case 'activity':
      return <ActivitySidebar onClose={p.onClose} {...collapseProps} />
    case 'admin':
      return <AdminSidebar grants={p.grants} isSuperAdmin={p.isAdmin} isPlatformAdmin={p.isPlatformAdmin} billingEnabled={p.billingEnabled} onClose={p.onClose} {...collapseProps} />
    case 'settings':
      return <SettingsSidebar onClose={p.onClose} canAccessBeta={p.canAccessBeta} {...collapseProps} />
    default:
      return null
  }
}
