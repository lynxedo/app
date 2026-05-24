'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { railFromPath } from './HubRail'
import {
  CatalogIcon,
  MoreIcon,
  catalogById,
  normalizeRailConfig,
  type RailConfig,
  type RailPermissions,
  type CatalogId,
} from './railCatalog'

export default function HubMobileBar({
  onMoreClick,
  onHubClick,
  onTimeClockClick,
  onActivityClick,
  onToolsClick,
  onLinksClick,
  isClockedIn,
  unreadHub,
  permissions,
  railConfig,
  hidden,
}: {
  onMoreClick: () => void
  onHubClick: () => void
  onTimeClockClick: () => void
  onActivityClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  isClockedIn?: boolean
  unreadHub?: boolean
  permissions: RailPermissions
  railConfig: RailConfig | null
  hidden?: boolean
}) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const active = railFromPath(pathname)
  const config = normalizeRailConfig(railConfig)
  const userSlot = config.mobile[0] ?? null

  function handleHubClick(e: React.MouseEvent) {
    e.preventDefault()
    onHubClick()
    let last: string | null = null
    try {
      last = window.localStorage.getItem('hub_last_chat_route') || window.localStorage.getItem('hub_last_route')
    } catch {}
    if (last && last.startsWith('/hub/') && last !== '/hub/home') {
      router.push(last)
    } else {
      router.push('/hub?source=push')
    }
  }

  function renderUserSlot() {
    if (!userSlot) return null
    if (typeof userSlot === 'string' && userSlot.startsWith('url:')) {
      const url = userSlot.slice(4)
      let label = url
      try { label = new URL(url).hostname.replace(/^www\./, '') } catch {}
      return (
        <a
          key="user"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium text-white/60 hover:text-white"
        >
          <CatalogIcon id="links" />
          <span className="truncate max-w-full px-1">{label}</span>
        </a>
      )
    }
    const entry = catalogById(userSlot as CatalogId, permissions)
    if (!entry) return null
    const isActive = active === entry.id
    const cls = `flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
      isActive ? 'text-amber-300' : 'text-white/60 hover:text-white'
    }`
    const inner = (
      <>
        {entry.icon}
        <span className="truncate max-w-full px-1">{entry.label}</span>
      </>
    )
    if (entry.id === 'tools') {
      return <button key="user" type="button" onClick={onToolsClick} className={cls}>{inner}</button>
    }
    if (entry.id === 'links') {
      return <button key="user" type="button" onClick={onLinksClick} className={cls}>{inner}</button>
    }
    if (entry.id === 'activity') {
      return <button key="user" type="button" onClick={onActivityClick} className={cls}>{inner}</button>
    }
    if (entry.href) {
      return <Link key="user" href={entry.href} className={cls}>{inner}</Link>
    }
    return null
  }

  return (
    <nav
      className={`md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch border-t border-gray-800 bg-gray-950 transition-transform duration-200 ${hidden ? 'translate-y-full' : 'translate-y-0'}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      aria-label="Hub bottom navigation"
    >
      {/* Time Clock — quick action, opens modal */}
      <button
        type="button"
        onClick={onTimeClockClick}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium text-white/60 hover:text-white"
        aria-label="Time clock"
      >
        <span className="relative">
          <CatalogIcon id="time-clock" />
          {isClockedIn && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-gray-950 bg-emerald-500" aria-hidden="true" />
          )}
        </span>
        <span>Clock</span>
      </button>

      {/* Hub */}
      <button
        type="button"
        onClick={handleHubClick}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
          active === 'hub' ? 'text-amber-300' : 'text-white/60 hover:text-white'
        }`}
      >
        <span className="relative">
          <CatalogIcon id="hub" />
          {unreadHub && (
            <span
              className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-400 border border-gray-950"
              aria-label="Unread messages"
            />
          )}
        </span>
        <span>Hub</span>
      </button>

      {/* Txt */}
      <Link
        href="/hub/clients"
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
          active === 'txt' ? 'text-amber-300' : 'text-white/60 hover:text-white'
        }`}
      >
        <CatalogIcon id="txt" />
        <span>Txt</span>
      </Link>

      {/* User-configurable slot */}
      {renderUserSlot()}

      {/* More */}
      <button
        type="button"
        onClick={onMoreClick}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium text-white/60 hover:text-white"
        aria-label="More"
      >
        <MoreIcon />
        <span>More</span>
      </button>
    </nav>
  )
}
