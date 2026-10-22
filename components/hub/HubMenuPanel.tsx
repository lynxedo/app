'use client'

// The Menu (desktop): every app, grouped the way the business thinks about it,
// with a line on what each one is for. Replaces the old Apps drawer's grid of
// tiles. Opened from Menu at the bottom of the rail and from the tab strip's +.
// Everything here opens as a tab (or jumps to the tab already open — the dot).

import { useEffect } from 'react'
import { CatalogIcon, SettingsIcon, AdminIcon, SearchIcon, catalogById, type CatalogId, type RailPermissions } from './railCatalog'
import { classifyToken } from '@/lib/hub-layout'
import type { RailId } from './HubRail'

type MenuItem = { id: string; label: string; href: string; desc: string; icon: React.ReactNode; railId: RailId | null }

const DESC: Record<string, string> = {
  hub: 'Rooms and direct messages',
  txt2: 'Customer text conversations',
  'email-inbox': 'Shared team email',
  dialer: 'Calls, voicemail and call history',
  'call-log': 'Every call, voicemail and recording',
  email: 'Newsletters and email campaigns',
  drip: 'Automatic follow-up for new leads',
  marketing: 'Social posts and marketing',
  contacts: 'Every customer and lead',
  tracker: 'Leads from first call to won',
  quotes: 'Build and send quotes',
  pricer: 'Price a job fast',
  lawn: 'Measure a lawn from the address',
  reports: 'Revenue, clients, sales and more',
  scoreboards: 'Boards built by the team',
  'daily-log-v2': 'Each tech’s stops for the day',
  routing: 'Build and optimize routes',
  fleet: 'Live truck map',
  'daily-log': 'Route sheets and service notes',
  'time-records': 'Clock-ins, approvals and payroll',
  'mix-sheet': 'Tank mixes for the day',
  'pesticide-records': 'Product application records',
  checks: 'Check and cash deposits',
  'my-tasks': 'Your tasks from every board',
  files: 'Shared files and tags',
  forms: 'Forms and responses',
  'company-news': 'Announcements and shout outs',
  feedback: 'Report a bug or ask for a feature',
  settings: 'Your Hub, notifications, sounds',
  admin: 'People, integrations, permissions',
  help: 'How everything works',
}

const COLUMNS: { label: string; ids: string[] }[][] = [
  [
    { label: 'Communicate', ids: ['hub', 'txt2', 'email-inbox', 'dialer', 'call-log'] },
    { label: 'Marketing', ids: ['email', 'drip', 'marketing'] },
  ],
  [
    { label: 'Customers & Sales', ids: ['contacts', 'tracker', 'quotes', 'pricer', 'lawn'] },
    { label: 'Insights', ids: ['reports', 'scoreboards'] },
  ],
  [
    { label: 'Field Ops', ids: ['daily-log-v2', 'routing', 'fleet', 'daily-log', 'time-records', 'mix-sheet', 'pesticide-records', 'checks'] },
  ],
  [
    { label: 'Company', ids: ['my-tasks', 'files', 'forms', 'company-news', 'feedback'] },
    { label: 'Settings & Admin', ids: ['settings', 'admin', 'help'] },
  ],
]

function TasksIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17" />
    </svg>
  )
}
function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01" />
    </svg>
  )
}

function resolveItem(id: string, permissions: RailPermissions, showAdmin: boolean): MenuItem | null {
  const desc = DESC[id] ?? ''
  if (id === 'hub') return { id, label: 'Hub', href: '/hub', desc, icon: <CatalogIcon id="hub" />, railId: 'hub' }
  if (id === 'my-tasks') return { id, label: 'My Tasks', href: '/hub/my-tasks', desc, icon: <TasksIcon />, railId: null }
  if (id === 'settings') return { id, label: 'Settings', href: '/hub/settings', desc, icon: <SettingsIcon />, railId: 'settings' }
  if (id === 'admin') return showAdmin ? { id, label: 'Admin', href: '/hub/admin', desc, icon: <AdminIcon />, railId: 'admin' } : null
  if (id === 'help') return { id, label: 'Help', href: '/help', desc, icon: <HelpIcon />, railId: null }
  const e = catalogById(id as CatalogId, permissions)
  if (!e || !e.href) return null
  return { id, label: e.label, href: e.href, desc, icon: e.icon, railId: id as RailId }
}

export default function HubMenuPanel({
  permissions,
  showAdmin,
  railItems,
  openCatalogIds,
  onOpen,
  onSearch,
  onEditRail,
  onClose,
}: {
  permissions: RailPermissions
  showAdmin: boolean
  /** The user's rail layout tokens — items on it get an "On rail" tag. */
  railItems: string[]
  /** Rail ids of the open tabs — those items get a dot. */
  openCatalogIds: RailId[]
  onOpen: (id: string, href: string, newCopy: boolean) => void
  onSearch: () => void
  onEditRail: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const onRail = new Set(railItems.map(t => classifyToken(t)).filter(c => c.kind === 'catalog').map(c => (c as { id: string }).id))
  const open = new Set<string>(openCatalogIds)

  const columns = COLUMNS.map(col => col
    .map(g => ({ label: g.label, items: g.ids.map(id => resolveItem(id, permissions, showAdmin)).filter((x): x is MenuItem => !!x) }))
    .filter(g => g.items.length > 0))
    .filter(col => col.length > 0)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed z-50 left-[76px] bottom-3 w-[min(1000px,calc(100vw-96px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border border-white/10 bg-gray-900 shadow-2xl p-4"
        role="dialog"
        aria-label="Menu"
        data-lx-nav="menu"
      >
        <button
          type="button"
          onClick={onSearch}
          className="w-full h-10 mb-4 flex items-center gap-2.5 px-3.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] text-white/50 text-[13.5px] text-left [&_svg]:w-4 [&_svg]:h-4"
        >
          <SearchIcon />
          <span className="flex-1">Search apps, customers, people, messages…</span>
        </button>

        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-3">
              {col.map(g => (
                <div key={g.label}>
                  <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{g.label}</div>
                  {g.items.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={e => onOpen(item.id, item.href, e.altKey)}
                      className="w-full flex items-start gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.06] group"
                      title={item.label}
                    >
                      <span className="flex-none w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center [&_svg]:w-[17px] [&_svg]:h-[17px]" style={{ color: 'var(--brand)' }}>
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white/90 group-hover:text-white">
                          {item.label}
                          {onRail.has(item.id) && (
                            <span className="text-[9px] font-semibold tracking-wide text-white/40 border border-white/15 rounded px-1 leading-[14px]">ON RAIL</span>
                          )}
                          {item.railId && open.has(item.railId) && (
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--brand)' }} title="Open in a tab" />
                          )}
                        </span>
                        <span className="text-[11.5px] leading-snug text-white/50">{item.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-white/[0.07] flex items-center gap-3">
          <span className="flex-1 text-[12px] text-white/40">Everything opens in a tab. A dot means it’s already open. Alt-click opens another copy.</span>
          <button
            type="button"
            onClick={onEditRail}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium text-white/70 hover:text-white hover:bg-white/[0.07]"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit rail
          </button>
        </div>
      </div>
    </>
  )
}
