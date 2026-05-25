'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
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
  ['/hub/dialer', 'dialer'],
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
  // Activity is always the floating bell now — silently ignore old configs
  // that still have 'activity' in a rail slot.
  if (value === 'activity') return { kind: 'empty' }
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
  unreadHub,
  isClockedIn,
  onSearchClick,
  onProfileClick,
  onToolsClick,
  onLinksClick,
  onTimeClockClick,
  onActivityClick,
  currentUserId,
  currentUserDisplayName,
  currentUserAvatarUrl,
  currentUserStatus,
  collapsed,
  onToggleCollapsed,
  onOpenSidebar,
  activeManualRail,
  permissions,
  railConfig,
}: {
  showAdmin: boolean
  unreadActivity?: number
  unreadChat?: number
  unreadTxt?: number
  unreadHub?: boolean
  isClockedIn?: boolean
  onSearchClick: () => void
  onProfileClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  onTimeClockClick: () => void
  onActivityClick: () => void
  currentUserId?: string
  currentUserDisplayName?: string
  currentUserAvatarUrl?: string | null
  currentUserStatus?: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenSidebar: () => void
  activeManualRail?: 'tools' | 'links' | 'profile' | 'activity' | null
  permissions: RailPermissions
  railConfig: RailConfig | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const active = railFromPath(pathname)
  // Effective rail for active-icon detection — manual overrides win for the
  // pathless rails (tools, links, profile). Means clicking the same icon
  // again can toggle collapse even when the section has no URL of its own.
  const effectiveActive: RailId = (activeManualRail as RailId) ?? active

  const config = normalizeRailConfig(railConfig)
  const slots = config.desktop.map(v => resolveSlot(v, permissions))

  // Scroll-affordance state for the configurable middle section. Updated on
  // scroll/resize so the up/down chevrons only render when there's actual
  // overflow to scroll through.
  const slotsScrollRef = useRef<HTMLDivElement | null>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  useEffect(() => {
    const el = slotsScrollRef.current
    if (!el) return
    function update() {
      if (!el) return
      setCanScrollUp(el.scrollTop > 2)
      setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [slots.length])
  function scrollSlots(direction: 'up' | 'down') {
    const el = slotsScrollRef.current
    if (!el) return
    el.scrollBy({ top: direction === 'up' ? -80 : 80, behavior: 'smooth' })
  }

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

  const isOnLanding = !!pathname && pathname.startsWith('/hub/home')

  function handleHubClick(e: React.MouseEvent) {
    e.preventDefault()
    // Already inside Hub (not on landing) → toggle. Covers both directions:
    // open → close, AND close → open. Used to only collapse when open.
    if (active === 'hub' && !isOnLanding) {
      onToggleCollapsed()
      return
    }
    // Navigating to a different section: always ensure sidebar is visible.
    onOpenSidebar()
    // Read both keys: hub_last_chat_route (set by HubShell on chat paths)
    // and hub_last_route (set by HubIdleTracker on every hub route load).
    // Either one means we can jump directly to a real room/DM.
    let last: string | null = null
    try {
      last = localStorage.getItem('hub_last_chat_route') || localStorage.getItem('hub_last_route')
    } catch {}
    if (last && last.startsWith('/hub/') && last !== '/hub/home') {
      router.push(last)
      return
    }
    // Nothing saved — go to /hub with ?source=push to bypass the 14h-idle
    // redirect (which would send us right back to /hub/home and look like
    // the click did nothing).
    router.push('/hub?source=push')
  }

  function handleToolsClick(e: React.MouseEvent) {
    e.preventDefault()
    if (effectiveActive === 'tools') { onToggleCollapsed(); return }
    onOpenSidebar()
    onToolsClick()
  }

  function handleLinksClick(e: React.MouseEvent) {
    e.preventDefault()
    if (effectiveActive === 'links') { onToggleCollapsed(); return }
    onOpenSidebar()
    onLinksClick()
  }

  function handleProfileClick(_e: React.MouseEvent) {
    if (effectiveActive === 'profile') { onToggleCollapsed(); return }
    onOpenSidebar()
    onProfileClick()
  }

  // Used for any nav item that links elsewhere (Txt, Settings, Admin, catalog
  // slots). Same icon clicked while already on it → toggle collapse and stop
  // the navigation. Different section → force the sidebar open and let the
  // Link navigate normally.
  function handleNavLinkClick(thisRail: RailId) {
    return (e: React.MouseEvent) => {
      if (active === thisRail) {
        e.preventDefault()
        onToggleCollapsed()
        return
      }
      onOpenSidebar()
    }
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

      {/* Fixed primary section — Clock, Hub, Txt never scroll */}
      <div className="flex-none flex flex-col py-1">
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

        <button
          type="button"
          onClick={handleHubClick}
          className={railBtnClass(active === 'hub')}
          aria-pressed={active === 'hub'}
          title="Hub"
        >
          <ActiveBar show={active === 'hub'} />
          <span className={`relative ${active === 'hub' ? 'text-amber-300' : ''}`}>
            <CatalogIcon id="hub" />
            {unreadHub && (
              <span
                className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-400 border-2 border-[#0a1f33]"
                aria-label="Unread messages"
              />
            )}
          </span>
          <span>Hub</span>
        </button>

        <Link
          href="/hub/clients"
          onClick={handleNavLinkClick('txt')}
          className={railBtnClass(active === 'txt')}
          aria-current={active === 'txt' ? 'page' : undefined}
          title="Client texts"
        >
          <ActiveBar show={active === 'txt'} />
          <span className={active === 'txt' ? 'text-amber-300' : ''}><CatalogIcon id="txt" /></span>
          <span>Txt</span>
        </Link>
      </div>

      {/* User-configurable slots — scrollable if they overflow. Explicit
          up/down chevrons appear only when overflow exists. */}
      <div className="flex-1 min-h-0 relative">
        {canScrollUp && (
          <button
            type="button"
            onClick={() => scrollSlots('up')}
            className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center h-5 bg-gradient-to-b from-[#0a1f33] via-[#0a1f33]/95 to-transparent text-white/60 hover:text-white"
            aria-label="Scroll rail up"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
        )}
        {canScrollDown && (
          <button
            type="button"
            onClick={() => scrollSlots('down')}
            className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center h-5 bg-gradient-to-t from-[#0a1f33] via-[#0a1f33]/95 to-transparent text-white/60 hover:text-white"
            aria-label="Scroll rail down"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
        <div ref={slotsScrollRef} className="absolute inset-0 overflow-y-auto py-1 flex flex-col">
          {slots.map((slot, idx) => {
            if (slot.kind === 'empty') return null
            const isActiveSlot = slot.kind === 'catalog' && active === slot.id
            if (slot.kind === 'catalog') {
              const onClick = (e: React.MouseEvent) => {
                if (slot.id === 'tools') { handleToolsClick(e); return }
                if (slot.id === 'links') { handleLinksClick(e); return }
                if (slot.id === 'activity') { e.preventDefault(); onActivityClick(); return }
                // Generic navigable slot: same icon → toggle collapse; else open.
                handleNavLinkClick(slot.id)(e)
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
      </div>

      {/* Fixed footer: Settings, Admin (gated), You */}
      <div className="flex-none flex flex-col border-t border-white/5">
        <Link
          href="/hub/settings"
          onClick={handleNavLinkClick('settings')}
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
            onClick={handleNavLinkClick('admin')}
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
          onClick={handleProfileClick}
          className="relative flex flex-col items-center justify-center gap-0.5 py-3 text-[10px] font-medium text-white/55 hover:text-white hover:bg-white/5 transition-colors"
          title={currentUserDisplayName ?? 'You'}
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0) + 0.75rem)' }}
        >
          <span className="relative w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-xs font-bold">
            {currentUserAvatarUrl && currentUserId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/profile/avatar/${currentUserId}?v=${encodeURIComponent(currentUserAvatarUrl)}`}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              firstInitial
            )}
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a1f33] ${statusColor}`} aria-hidden="true" />
          </span>
          <span>You</span>
        </button>
      </div>
    </nav>
  )
}
