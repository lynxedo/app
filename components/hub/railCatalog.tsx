/* Shared icon + nav catalog for the Hub rail, mobile bottom bar, and the
 * Settings → My Hub picker. Every entry has an SVG glyph drawn in the same
 * stroked-outline style so the rail stays visually consistent. */

import type { ReactNode } from 'react'

export type CatalogId =
  | 'time-clock'    // fixed (always shown)
  | 'hub'           // fixed
  | 'txt2'          // Twilio /hub/txt texting (labeled "Txt"), gated by canAccessTxt
  | 'activity'      // can be in rail OR as a floating bell
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
  | 'email'         // Email Marketing, gated by canAccessEmail
  | 'pesticide-records'
  | 'forms'
  | 'reports'
  | 'scoreboards'
  | 'pricer'        // staff quoting tool, gated by canAccessPricer
  | 'mix-sheet'     // technician tank mix sheet (all users view, admins edit)
  | 'feedback'      // Report an Issue — bug reports + feature requests (all users)
  | 'people'        // admin-only (Admin → People)
  | 'guardian'      // admin-only (Admin → Guardian)
  | 'products'      // admin-only (Admin → Products)
  | 'announcements' // admin-only (Admin → Announcements)
  | 'file-tags'     // admin-only (Admin → File Tags)

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
  canAccessTxt: boolean
  canAccessCallLog: boolean
  canAccessCallLog2: boolean
  canAccessTimesheet: boolean
  canAccessMarketing: boolean
  canAccessEmail: boolean
  canAccessForms: boolean
  canAccessDailyLogV2: boolean
  canAccessScoreboards: boolean
  canAccessFiles: boolean
  canAccessPesticideRecords: boolean
  canAccessPricer: boolean
  canAccessHub: boolean
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
  // Txt (Twilio texting) — chat bubble with text lines, distinct from the
  // single-bubble 'hub' glyph.
  txt2: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  activity: 'M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0',
  // Custom URL — a plain chain-link glyph for a user's own app-drawer link.
  customUrl: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
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
  // Email marketing — envelope
  email: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  // Pesticide records — chemistry flask with a marker dot, plus a cap notch
  pesticideRecords: 'M9 3h6M10 3v5l-5 9a2 2 0 001.7 3h10.6a2 2 0 001.7-3l-5-9V3M8 14h8M13 11.5a.5.5 0 11-1 0 .5.5 0 011 0z',
  forms: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h3',
  reports: 'M3 18h4v-5H3v5zm6 0h4V6H9v12zm6 0h4V10h-4v8z',
  // Scoreboards — a 4-panel dashboard layout (distinct from the reports bars).
  scoreboards: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  // Do Not Disturb — classic minus-in-circle.
  dnd: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12h8',
  search: 'M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
  settings: 'M10.325 4.317a2 2 0 013.35 0l.554.916a2 2 0 002.146.96l1.05-.224a2 2 0 012.39 2.39l-.224 1.05a2 2 0 00.96 2.146l.916.554a2 2 0 010 3.35l-.916.554a2 2 0 00-.96 2.146l.224 1.05a2 2 0 01-2.39 2.39l-1.05-.224a2 2 0 00-2.146.96l-.554.916a2 2 0 01-3.35 0l-.554-.916a2 2 0 00-2.146-.96l-1.05.224a2 2 0 01-2.39-2.39l.224-1.05a2 2 0 00-.96-2.146l-.916-.554a2 2 0 010-3.35l.916-.554a2 2 0 00.96-2.146l-.224-1.05a2 2 0 012.39-2.39l1.05.224a2 2 0 002.146-.96l.554-.916zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  admin: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z',
  // People (team members) — a pair of figures, distinct from the single-figure
  // 'contacts' (customers) glyph.
  people: 'M9 11.5a3.25 3.25 0 100-6.5 3.25 3.25 0 000 6.5zM3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1M16.5 5.3a3.25 3.25 0 010 6.4M22 20v-1a5 5 0 00-3.8-4.85',
  // Guardian (the AI assistant bot) — a friendly robot head with antenna.
  guardian: 'M12 3.5h.01M12 4.2v2.3M7.5 6.5h9A1.5 1.5 0 0118 8v8a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 16V8a1.5 1.5 0 011.5-1.5zM9.75 11h.01M14.25 11h.01M10 14.5h4',
  // Products / inventory — a 3D cube.
  products: 'M12 2.5l8.5 4.75v9.5L12 21.5 3.5 16.75v-9.5L12 2.5zM3.5 7.25 12 12l8.5-4.75M12 12v9.5',
  // Announcements — a bullhorn with sound waves (distinct from the filled
  // megaphone used for Marketing).
  announcements: 'M3 9v6h4l5 4V5L7 9H3zM15.5 9a4 4 0 010 6M17.5 7a7 7 0 010 10',
  // File Tags — a luggage-style tag with its hole.
  fileTags: 'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6.5 6.5h.01',
  // Pricer (staff quoting tool) — a calculator with a result row + keypad dots.
  pricer: 'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01',
  // Mix Sheet — a table/grid: outline + header row + first-column divider.
  mixSheet: 'M4 5h16v14H4zM4 9h16M9 9v10',
  // Report an Issue — a flag on a pole (raise a flag / report an issue).
  feedback: 'M5 3v18M5 4h12l-2.2 3.5L17 11H5',
}

// Reusable icon factory (also used by the Tools sidebar and Hub sidebar
// to render the same glyphs inside their list rows).
export function CatalogIcon({ id }: { id: CatalogId }) {
  switch (id) {
    case 'time-clock':  return <I d={PATHS.timeClock} />
    case 'hub':         return <I d={PATHS.hub} />
    case 'txt2':        return <I d={PATHS.txt2} />
    case 'activity':    return <I d={PATHS.activity} />
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
    case 'email':         return <I d={PATHS.email} />
    case 'pesticide-records': return <I d={PATHS.pesticideRecords} />
    case 'forms':         return <I d={PATHS.forms} />
    case 'reports':       return <I d={PATHS.reports} />
    case 'scoreboards':   return <I d={PATHS.scoreboards} />
    case 'pricer':        return <I d={PATHS.pricer} />
    case 'mix-sheet':     return <I d={PATHS.mixSheet} />
    case 'feedback':      return <I d={PATHS.feedback} />
    case 'people':        return <I d={PATHS.people} />
    case 'guardian':      return <I d={PATHS.guardian} />
    case 'products':      return <I d={PATHS.products} />
    case 'announcements': return <I d={PATHS.announcements} />
    case 'file-tags':     return <I d={PATHS.fileTags} />
  }
}

// More + Search aren't first-class catalog ids but use the same factory.
export function MoreIcon() { return <I d={PATHS.more} /> }

// 3×3 grid "all apps" glyph — shared by the desktop rail launcher button and
// the mobile bottom-bar Apps button so the entry point reads the same on both.
export function AppsIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="4" height="4" rx="1" />
      <rect x="10" y="4" width="4" height="4" rx="1" />
      <rect x="16" y="4" width="4" height="4" rx="1" />
      <rect x="4" y="10" width="4" height="4" rx="1" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <rect x="16" y="10" width="4" height="4" rx="1" />
      <rect x="4" y="16" width="4" height="4" rx="1" />
      <rect x="10" y="16" width="4" height="4" rx="1" />
      <rect x="16" y="16" width="4" height="4" rx="1" />
    </svg>
  )
}
export function SearchIcon() { return <I d={PATHS.search} /> }
export function SettingsIcon() { return <I d={PATHS.settings} /> }
export function AdminIcon() { return <I d={PATHS.admin} /> }
export function DndIcon() { return <I d={PATHS.dnd} /> }

// Stylized padlock for private rooms (replaces the 🔒 emoji). Inherits the
// current text color; size via className.
export function LockIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.4" />
      <path strokeLinecap="round" d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  )
}

// Generic icon for a user's own custom app-drawer link (a 'url:<href>' token).
export function CustomUrlIcon() { return <I d={PATHS.customUrl} /> }

// Catalog definition. Order is the order they appear in the picker.
// Note: 'activity' is NOT pickable — the floating bell in the top-right is
// always present and is the only Activity entry point.
export const CATALOG: Omit<CatalogEntry, 'icon'>[] = [
  { id: 'activity',     label: 'Activity',      pickable: false },
  { id: 'daily-log',    label: 'Daily Log',     href: '/hub/daily-log', prefixMatch: true, pickable: true },
  { id: 'daily-log-v2', label: 'Daily Log v2',  href: '/hub/daily-log-v2', prefixMatch: true, pickable: true, requires: 'canAccessDailyLogV2' },
  { id: 'tracker',      label: 'Tracker',       href: '/hub/tracker', prefixMatch: true, pickable: true, requires: 'canAccessTracker' },
  { id: 'routing',      label: 'Routing',       href: '/hub/routing', prefixMatch: true, pickable: true, requires: 'canAccessRouting' },
  { id: 'fleet',        label: 'Fleet',         href: '/hub/fleet', prefixMatch: true, pickable: true, requires: 'canAccessFleet' },
  { id: 'books',        label: 'Books',         href: '/hub/books', prefixMatch: true, pickable: true, requires: 'canAccessBooks' },
  { id: 'lawn',         label: 'Lawn Sizer',    href: '/hub/lawn', pickable: true, requires: 'canAccessLawn' },
  { id: 'zone-sizer',   label: 'Zone Sizer',    href: '/hub/zone-sizer', pickable: true, requires: 'canAccessZoneSizer' },
  { id: 'dialer',       label: 'Dialer',        href: '/hub/dialer', prefixMatch: true, pickable: true, requires: 'canAccessDialer' },
  { id: 'txt2',         label: 'Txt',           href: '/hub/txt', prefixMatch: true, pickable: true, requires: 'canAccessTxt' },
  { id: 'call-log',     label: 'Call Log',      href: '/hub/call-log', prefixMatch: true, pickable: true, requires: 'canAccessCallLog' },
  { id: 'time-records', label: 'Time Records',  href: '/hub/admin/timesheet', prefixMatch: true, pickable: true, requires: 'isAdmin' },
  { id: 'files',        label: 'Files',         href: '/hub/files', pickable: true, requires: 'canAccessFiles' },
  { id: 'company-news', label: 'Company News',  href: '/hub/pages/company-news', pickable: true },
  { id: 'contacts',     label: 'Contacts',      href: '/hub/contacts', prefixMatch: true, pickable: true, requires: 'canAccessHub' },
  { id: 'marketing', label: 'Marketing', href: '/hub/marketing', prefixMatch: true, pickable: true, requires: 'canAccessMarketing' },
  { id: 'email',     label: 'Email',     href: '/hub/marketing/email', prefixMatch: true, pickable: true, requires: 'canAccessEmail' },
  { id: 'pesticide-records', label: 'Products Used', href: '/hub/pesticide-records', prefixMatch: true, pickable: true, requires: 'canAccessPesticideRecords' },
  { id: 'forms',     label: 'Forms',     href: '/hub/forms', prefixMatch: true, pickable: true, requires: 'canAccessForms' },
  { id: 'reports',   label: 'Reports',   href: '/hub/reports', prefixMatch: true, pickable: true, requires: 'isAdmin' },
  { id: 'scoreboards', label: 'Scoreboards', href: '/hub/scoreboards', prefixMatch: true, pickable: true, requires: 'canAccessScoreboards' },
  { id: 'pricer',      label: 'Pricer',      href: '/hub/pricer', prefixMatch: true, pickable: true, requires: 'canAccessPricer' },
  { id: 'mix-sheet',   label: 'Mix Sheet',   href: '/hub/mix-sheet', prefixMatch: true, pickable: true },
  { id: 'feedback',    label: 'Report an Issue', href: '/hub/feedback', prefixMatch: true, pickable: true },
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
