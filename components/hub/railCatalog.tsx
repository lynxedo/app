/* Shared icon + nav catalog for the Hub rail, mobile bottom bar, and the
 * Settings → My Hub picker. Every entry has an SVG glyph drawn in the same
 * stroked-outline style so the rail stays visually consistent. */

import type { ReactNode } from 'react'

export type CatalogId =
  | 'time-clock'    // fixed (always shown)
  | 'hub'           // fixed
  | 'txt'           // fixed
  | 'activity'      // can be in rail OR as a floating bell
  | 'tools'
  | 'links'
  | 'tracker'
  | 'routing'
  | 'fleet'
  | 'books'
  | 'lawn'
  | 'zone-sizer'
  | 'dialer'
  | 'call-log'
  | 'time-records'  // admin-only
  | 'daily-log'
  | 'daily-log-v2'
  | 'files'
  | 'company-news'
  | 'contacts'
  | 'marketing'

export type CatalogEntry = {
  id: CatalogId
  label: string
  href?: string                   // null for items that aren't direct nav
  prefixMatch?: boolean           // active-state matching
  icon: ReactNode
  /** Show in rail/mobile picker */
  pickable: boolean
  /** Permission gate; if false the icon is hidden */
  requires?: keyof RailPermissions
}

export type RailPermissions = {
  isAdmin: boolean
  canAccessTracker: boolean
  canAccessRouting: boolean
  canAccessFleet: boolean
  canAccessBooks: boolean
  canAccessLawn: boolean
  canAccessZoneSizer: boolean
  canAccessDialer: boolean
  canAccessCallLog: boolean
  canAccessTimesheet: boolean
  canAccessMarketing: boolean
}

function I({ d, fill = false }: { d: string; fill?: boolean }) {
  return (
    <svg
      className="w-5 h-5"
      fill={fill ? 'currentColor' : 'none'}
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

// All glyphs are intentionally drawn in the same stroked-outline style at
// 24x24 with stroke-width 1.8 so the rail is visually homogeneous.
const PATHS = {
  timeClock: 'M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  hub: 'M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4-.85L3 21l1.93-4.13A7.94 7.94 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  txt: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 14h6M9 18h4',
  activity: 'M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0',
  tools: 'M11.42 15.17L17.25 21A2.65 2.65 0 0021 17.25l-5.83-5.83m-3.75 3.75L4.5 7.5A2.65 2.65 0 014.5 3.75L9.34 8.59m1.83 6.58l-6.71 6.71',
  links: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
  tracker: 'M3 12l4-4 5 5 8-8M15 5h6v6',
  routing: 'M3 12h4l3-9 4 18 3-9h4',
  fleet: 'M3 17h2a2 2 0 014 0h6a2 2 0 014 0h2v-7l-3-4H8L3 10v7zM5 17a2 2 0 104 0M15 17a2 2 0 104 0',
  books: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z',
  lawn: 'M12 22V8M12 8c0-3 2-5 5-5-1 3-2 5-5 5zm0 0c0-3-2-5-5-5 1 3 2 5 5 5zM5 15c2.5 0 5 1.5 5 4M19 15c-2.5 0-5 1.5-5 4',
  zoneSizer: 'M4 14C4 8 8 4 12 4S20 8 20 14M12 14V20M8 20H16',
  dialer: 'M6 4h3l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v3a2 2 0 01-2 2A14 14 0 014 6a2 2 0 012-2z',
  callLog: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z',
  timeRecords: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  dailyLog: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h6',
  dailyLogV2: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 11l1.5 1.5L13 10M9 16l1.5 1.5L13 14.5',
  files: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  companyNews: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l6 6v8a2 2 0 01-2 2zM15 4v5h5M8 13h8M8 17h5',
  contacts: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM3 21v-2a6 6 0 016-6h6a6 6 0 016 6v2M19 8h3m-1.5-1.5v3',
  marketing: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.952 9.168-5v10c-1.543-3.048-5.068-5-9.168-5H7a3.988 3.988 0 00-1.564.317z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
  settings: 'M10.325 4.317a2 2 0 013.35 0l.554.916a2 2 0 002.146.96l1.05-.224a2 2 0 012.39 2.39l-.224 1.05a2 2 0 00.96 2.146l.916.554a2 2 0 010 3.35l-.916.554a2 2 0 00-.96 2.146l.224 1.05a2 2 0 01-2.39 2.39l-1.05-.224a2 2 0 00-2.146.96l-.554.916a2 2 0 01-3.35 0l-.554-.916a2 2 0 00-2.146-.96l-1.05.224a2 2 0 01-2.39-2.39l.224-1.05a2 2 0 00-.96-2.146l-.916-.554a2 2 0 010-3.35l.916-.554a2 2 0 00.96-2.146l-.224-1.05a2 2 0 012.39-2.39l1.05.224a2 2 0 002.146-.96l.554-.916zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  admin: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z',
}

// Reusable icon factory (also used by the Tools sidebar and Hub sidebar
// to render the same glyphs inside their list rows).
export function CatalogIcon({ id }: { id: CatalogId }) {
  switch (id) {
    case 'time-clock':  return <I d={PATHS.timeClock} />
    case 'hub':         return <I d={PATHS.hub} />
    case 'txt':         return <I d={PATHS.txt} />
    case 'activity':    return <I d={PATHS.activity} />
    case 'tools':       return <I d={PATHS.tools} />
    case 'links':       return <I d={PATHS.links} />
    case 'tracker':     return <I d={PATHS.tracker} />
    case 'routing':     return <I d={PATHS.routing} />
    case 'fleet':       return <I d={PATHS.fleet} />
    case 'books':       return <I d={PATHS.books} />
    case 'lawn':        return <I d={PATHS.lawn} />
    case 'zone-sizer':  return <I d={PATHS.zoneSizer} />
    case 'dialer':      return <I d={PATHS.dialer} />
    case 'call-log':    return <I d={PATHS.callLog} />
    case 'time-records':return <I d={PATHS.timeRecords} />
    case 'daily-log':   return <I d={PATHS.dailyLog} />
    case 'daily-log-v2': return <I d={PATHS.dailyLogV2} />
    case 'files':       return <I d={PATHS.files} />
    case 'company-news':return <I d={PATHS.companyNews} />
    case 'contacts':    return <I d={PATHS.contacts} />
    case 'marketing':     return <I d={PATHS.marketing} />
  }
}

// More + Search aren't first-class catalog ids but use the same factory.
export function MoreIcon() { return <I d={PATHS.more} /> }
export function SearchIcon() { return <I d={PATHS.search} /> }
export function SettingsIcon() { return <I d={PATHS.settings} /> }
export function AdminIcon() { return <I d={PATHS.admin} /> }

// Catalog definition. Order is the order they appear in the picker.
// Note: 'activity' is NOT pickable — the floating bell in the top-right is
// always present and is the only Activity entry point.
export const CATALOG: Omit<CatalogEntry, 'icon'>[] = [
  { id: 'tools',        label: 'Tools',         pickable: true },
  { id: 'links',        label: 'Links',         pickable: true },
  { id: 'activity',     label: 'Activity',      pickable: false },
  { id: 'daily-log',    label: 'Daily Log',     href: '/hub/daily-log', prefixMatch: true, pickable: true },
  { id: 'daily-log-v2', label: 'Daily Log v2',  href: '/hub/daily-log-v2', prefixMatch: true, pickable: true },
  { id: 'tracker',      label: 'Tracker',       href: '/hub/tracker', prefixMatch: true, pickable: true, requires: 'canAccessTracker' },
  { id: 'routing',      label: 'Routing',       href: '/hub/routing', prefixMatch: true, pickable: true, requires: 'canAccessRouting' },
  { id: 'fleet',        label: 'Fleet',         href: '/hub/fleet', prefixMatch: true, pickable: true, requires: 'canAccessFleet' },
  { id: 'books',        label: 'Books',         href: '/hub/books', prefixMatch: true, pickable: true, requires: 'canAccessBooks' },
  { id: 'lawn',         label: 'Lawn Sizer',    href: '/hub/lawn', pickable: true, requires: 'canAccessLawn' },
  { id: 'zone-sizer',   label: 'Zone Sizer',    href: '/hub/zone-sizer', pickable: true, requires: 'canAccessZoneSizer' },
  { id: 'dialer',       label: 'Dialer',        href: '/hub/dialer', prefixMatch: true, pickable: true, requires: 'canAccessDialer' },
  { id: 'call-log',     label: 'Call Log',      href: '/hub/call-log', prefixMatch: true, pickable: true, requires: 'canAccessCallLog' },
  { id: 'time-records', label: 'Time Records',  href: '/hub/admin/timesheet', prefixMatch: true, pickable: true, requires: 'isAdmin' },
  { id: 'files',        label: 'Files',         href: '/hub/files', pickable: true },
  { id: 'company-news', label: 'Company News',  href: '/hub/pages/company-news', pickable: true },
  { id: 'contacts',     label: 'Contacts',      href: '/hub/contacts', prefixMatch: true, pickable: true },
  { id: 'marketing', label: 'Marketing', href: '/hub/marketing/social', prefixMatch: true, pickable: true, requires: 'canAccessMarketing' },
]

export function catalogEntriesFor(perms: RailPermissions): CatalogEntry[] {
  return CATALOG
    .filter(e => !e.requires || !!perms[e.requires])
    .map(e => ({ ...e, icon: <CatalogIcon id={e.id} /> }))
}

export function catalogById(id: CatalogId, perms: RailPermissions): CatalogEntry | null {
  const e = CATALOG.find(x => x.id === id)
  if (!e) return null
  if (e.requires && !perms[e.requires]) return null
  return { ...e, icon: <CatalogIcon id={e.id} /> }
}

// Default rail config when the user hasn't set one yet.
export const DEFAULT_RAIL_CONFIG: { desktop: (CatalogId | null)[]; mobile: (CatalogId | null)[] } = {
  desktop: ['tools', 'links', 'daily-log', null],
  mobile:  ['tools'],
}

export type RailConfig = {
  desktop: (CatalogId | string | null)[]   // string = "url:https://..."
  mobile: (CatalogId | string | null)[]
}

export function normalizeRailConfig(raw: unknown): RailConfig {
  const safe = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const desktop = Array.isArray(safe.desktop) ? safe.desktop.slice(0, 4) : DEFAULT_RAIL_CONFIG.desktop
  const mobile  = Array.isArray(safe.mobile)  ? safe.mobile.slice(0, 1)  : DEFAULT_RAIL_CONFIG.mobile
  while (desktop.length < 4) desktop.push(null)
  while (mobile.length  < 1) mobile.push(null)
  return { desktop: desktop as RailConfig['desktop'], mobile: mobile as RailConfig['mobile'] }
}
