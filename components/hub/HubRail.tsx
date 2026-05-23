'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import {
  CatalogIcon,
  SearchIcon,
  SettingsIcon,
  AdminIcon,
  catalogById,
  normalizeRailConfig,
  type CatalogId,
  type RailPermissions,
  type RailConfig,
} from './railCatalog'

export type RailId =
  | 'time-clock'
  | 'hub'
  | 'txt'
  | 'tools'
  | 'links'
  | 'admin'
  | 'settings'
  | 'profile'
  | CatalogId

// Path → rail. First match wins. Used so the visited section's icon shows the
// active accent bar regardless of which slot it occupies.
const RAIL_BY_PREFIX: Array<[string, RailId]> = [
  ['/hub/home', 'hub'],          // landing page treated as hub-adjacent
  ['/hub/clients', 'txt'],
  ['/hub/activity', 'activity'],
  ['/hub/admin', 'admin'],
  ['/hub/settings', 'settings'],
  ['/hub/tracker', 'tracker'],
  ['/hub/routing', 'routing'],
  ['/hub/fleet', 'fleet'],
  ['/hub/books', 'books'],
  ['/hub/lawn', 'lawn'],
  ['/hub/call-log', 'call-log'],
  ['/hub/timesheet', 'time-records'],
  ['/hub/daily-log', 'daily-log'],
  ['/hub/files', 'files'],
  ['/hub/pages/company-news', 'company-news'],
]

export function railFromPath(pathname: string | null | undefined): RailId {
  if (!pathname) return 'hub'
  for (const [prefix, id] of RAIL_BY_PREFIX) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return id
  }
  if (pathname.startsWith('/hub')) return 'hub'
  return 'hub'
}

type SlotItem =
  | { kind: 'catalog'; id: CatalogId; href: string | null; label: string; icon: React.ReactNode }
  | { kind: 'url'; url: string; label: string; icon: React.ReactNode }
  | { kind: 'empty' }

function resolveSlot(value: CatalogId | string | null, perms: RailPermissions): SlotItem {
  if (!value) return { kind: 'empty' }
  if (typeof value === 'string' && value.startsWith('url:')) {
    const url = value.slice(4)
    let label = url
    try { label = new URL(url).hostname.replace(/^www\./, '') } catch {}
    return { kind: 'url', url, label, icon: <CatalogIcon id="links" /> }
  }
  const entry = catalogById(value as CatalogId, perms)
  if (!entry) return { kind: 'empty' }
  return { kind: 'catalog', id: entry.id, href: entry.href ?? null, label: entry.label, icon: entry.icon }
}

export default function HubRail({
  showAdmin,
  unreadActivity: _unreadActivity, // unused — Activity is now a floating bell
  unreadChat: _unreadChat,
  unreadTxt: _unreadTxt,
  isClockedIn,
  onSearchClick,
  onProfileClick,
  onToolsClick,
  onLinksClick,
  onTimeClockClick,
  onActivityClick,
  currentUserDisplayName,
  currentUserStatus,
  collapsed,
  onToggleCollapsed,
  permissions,
  railConfig,
}: {
  showAdmin: boolean
  unreadActivity?: number
  unreadChat?: number
  unreadTxt?: number
  isClockedIn?: boolean
  onSearchClick: () => void
  onProfileClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  onTimeClockClick: () => void
  onActivityClick: () => void
  currentUserDisplayName?: string
  currentUserStatus?: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  permissions: RailPermissions
  railConfig: RailConfig | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const active = railFromPath(pathname)

  const config = normalizeRailConfig(railConfig)
  const slots = config.desktop.map(v => resolveSlot(v, permissions))

  // Cmd/Ctrl + 1..5 keyboard shortcuts for the fixed primary sections.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.shiftKey || e.altKey) return
      switch (e.key) {
        case '1': e.preventDefault(); onTimeClockClick(); break
        case '2': e.preventDefault(); {
          let last: string | null = null
          try { last = localStorage.getItem('hub_last_chat_route') } catch {}
          router.push(last || '/hub')
          break
        }
        case '3': e.preventDefault(); router.push('/hub/clients'); break
        case '4': e.preventDefault(); onActivityClick(); break
        case '5': e.preventDefault(); onToolsClick(); break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [router, onTimeClockClick, onActivityClick, onToolsClick])

  function handleHubClick(e: React.MouseEvent) {
    e.preventDefault()
    if (active === 'hub' && !collapsed) { onToggleCollapsed(); return }
    let last: string | null = null
    try { last = localStorage.getItem('hub_last_chat_route') } catch {}
    router.push(last || '/hub')
  }

  function handleToolsClick(e: React.MouseEvent) {
    e.preventDefault()
    if (active === 'tools' && !collapsed) { onToggleCollapsed(); return }
    onToolsClick()
  }

  function handleLinksClick(e: React.MouseEvent) {
    e.preventDefault()
    if (active === 'links' && !collapsed) { onToggleCollapsed(); return }
    onLinksClick()
  }

  const statusColor =
    currentUserStatus === 'dnd' ? 'bg-red-500'
    : currentUserStatus === 'busy' ? 'bg-yellow-400'
    : currentUserStatus === 'offline' ? 'bg-gray-500'
    : 'bg-emerald-500'

  const firstInitial = (currentUserDisplayName ?? '?').trim().charAt(0).toUpperCase() || '?'

  const railBtnClass = (isActive: boolean) => [
    'relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
    isActive ? 'text-white' : 'text-white/55 hover:text-white hover:bg-white/5',
  ].join(' ')

  function ActiveBar({ show }: { show: boolean }) {
    return show ? (
      <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-amber-400" aria-hidden="true" />
    ) : null
  }

  return (
    <nav
      className="hidden md:flex flex-col w-16 bg-[#0a1f33] border-r border-white/5 flex-none"
      style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
      aria-label="Hub navigation"
    >
      {/* Search */}
      <button
        type="button"
        onClick={onSearchClick}
        className="flex flex-col items-center justify-center gap-0.5 py-3 text-[10px] font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        title="Search (⌘K)"
      >
        <SearchIcon />
        <span>Search</span>
      </button>

      <div className="h-px bg-white/5 mx-3" />

      <div className="flex-1 flex flex-col py-1 overflow-y-auto">
        {/* Fixed: Time Clock */}
        <button
          type="button"
          onClick={onTimeClockClick}
          className={railBtnClass(false)}
          title={isClockedIn ? 'Clocked in — tap to clock out' : 'Clock in / out'}
        >
          <span className="relative">
            <CatalogIcon id="time-clock" />
            {isClockedIn && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a1f33] bg-emerald-500" aria-hidden="true" />
            )}
          </span>
          <span>Clock</span>
        </button>

        {/* Fixed: Hub */}
        <button
          type="button"
          onClick={handleHubClick}
          className={railBtnClass(active === 'hub')}
          aria-pressed={active === 'hub'}
          title="Hub"
        >
          <ActiveBar show={active === 'hub'} />
          <span className={active === 'hub' ? 'text-amber-300' : ''}><CatalogIcon id="hub" /></span>
          <span>Hub</span>
        </button>

        {/* Fixed: Txt */}
        <Link
          href="/hub/clients"
          className={railBtnClass(active === 'txt')}
          aria-current={active === 'txt' ? 'page' : undefined}
          title="Client texts"
        >
          <ActiveBar show={active === 'txt'} />
          <span className={active === 'txt' ? 'text-amber-300' : ''}><CatalogIcon id="txt" /></span>
          <span>Txt</span>
        </Link>

        {/* User-configurable slots */}
        {slots.map((slot, idx) => {
          if (slot.kind === 'empty') return null
          const isActiveSlot = slot.kind === 'catalog' && active === slot.id
          if (slot.kind === 'catalog') {
            const onClick = (e: React.MouseEvent) => {
              if (slot.id === 'tools') { handleToolsClick(e); return }
              if (slot.id === 'links') { handleLinksClick(e); return }
              if (slot.id === 'activity') { e.preventDefault(); onActivityClick(); return }
            }
            const cls = railBtnClass(isActiveSlot)
            const body = (
              <>
                <ActiveBar show={isActiveSlot} />
                <span className={isActiveSlot ? 'text-amber-300' : ''}>{slot.icon}</span>
                <span className="truncate max-w-[58px]">{slot.label}</span>
              </>
            )
            if (slot.href) {
              return (
                <Link key={idx} href={slot.href} onClick={onClick} className={cls} title={slot.label}>{body}</Link>
              )
            }
            return (
              <button key={idx} type="button" onClick={onClick} className={cls} title={slot.label}>{body}</button>
            )
          }
          // url
          return (
            <a
              key={idx}
              href={slot.url}
              target="_blank"
              rel="noopener noreferrer"
              className={railBtnClass(false)}
              title={slot.url}
            >
              {slot.icon}
              <span className="truncate max-w-[58px]">{slot.label}</span>
            </a>
          )
        })}
      </div>

      {/* Fixed footer: Settings, Admin (gated), You */}
      <div className="flex flex-col">
        <Link
          href="/hub/settings"
          className={railBtnClass(active === 'settings')}
          aria-current={active === 'settings' ? 'page' : undefined}
          title="Settings"
        >
          <ActiveBar show={active === 'settings'} />
          <span className={active === 'settings' ? 'text-amber-300' : ''}><SettingsIcon /></span>
          <span>Settings</span>
        </Link>
        {showAdmin && (
          <Link
            href="/hub/admin"
            className={railBtnClass(active === 'admin')}
            aria-current={active === 'admin' ? 'page' : undefined}
            title="Admin"
          >
            <ActiveBar show={active === 'admin'} />
            <span className={active === 'admin' ? 'text-amber-300' : ''}><AdminIcon /></span>
            <span>Admin</span>
          </Link>
        )}
        <button
          type="button"
          onClick={onProfileClick}
          className="relative flex flex-col items-center justify-center gap-0.5 py-3 text-[10px] font-medium text-white/55 hover:text-white hover:bg-white/5 transition-colors"
          title={currentUserDisplayName ?? 'You'}
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0) + 0.75rem)' }}
        >
          <span className="relative w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-xs font-bold">
            {firstInitial}
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a1f33] ${statusColor}`} aria-hidden="true" />
          </span>
          <span>You</span>
        </button>
      </div>
    </nav>
  )
}
