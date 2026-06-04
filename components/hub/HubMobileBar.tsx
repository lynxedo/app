'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { railFromPath } from './HubRail'
import {
  CatalogIcon,
  AppsIcon,
  catalogById,
  normalizeRailConfig,
  type RailConfig,
  type RailPermissions,
  type CatalogId,
} from './railCatalog'

export default function HubMobileBar({
  onMoreClick,
  onHubClick,
  onTxtClick,
  onPhoneClick,
  onUserSlotNav,
  onTimeClockClick,
  onToolsClick,
  onLinksClick,
  isClockedIn,
  unreadHub,
  unheardVoicemails,
  txtUnread,
  missedCall,
  dailyLogUnread,
  canAccessDialer,
  permissions,
  railConfig,
  hidden,
  drawerOpen,
  activeManualRail,
  onCloseDrawer,
}: {
  onMoreClick: () => void
  onHubClick: () => void
  onTxtClick: () => void
  onPhoneClick: () => void
  /** Open the mobile drawer for a sidebar-backed user slot (Txt2 / Dialer). */
  onUserSlotNav?: () => void
  onTimeClockClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  isClockedIn?: boolean
  unreadHub?: boolean
  unheardVoicemails?: number
  txtUnread?: boolean
  missedCall?: boolean
  dailyLogUnread?: boolean
  canAccessDialer?: boolean
  permissions: RailPermissions
  railConfig: RailConfig | null
  hidden?: boolean
  drawerOpen?: boolean
  activeManualRail?: string | null
  onCloseDrawer?: () => void
}) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const active = railFromPath(pathname)
  const config = normalizeRailConfig(railConfig)
  const userSlot = config.mobile[0] ?? null

  // Catalog ids whose section has its own mobile drawer sidebar — tapping their
  // user-slot icon should open/close that drawer (like the fixed Hub/Txt/Phone
  // buttons), not just navigate.
  const SIDEBAR_BACKED = new Set<CatalogId>(['txt2', 'dialer'])

  // Orange unread dot for the configurable user slot, mirroring the desktop rail.
  function slotDot(id: CatalogId): boolean {
    if (id === 'txt2') return !!txtUnread
    if (id === 'dialer') return !!missedCall
    if (id === 'daily-log') return !!dailyLogUnread
    return false
  }

  function handleHubClick(e: React.MouseEvent) {
    e.preventDefault()
    // Tap-to-toggle: if the drawer is open showing the Hub sidebar, close it.
    if (drawerOpen && active === 'hub' && !activeManualRail) {
      onCloseDrawer?.()
      return
    }
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

  function handleTxtClick(e: React.MouseEvent) {
    e.preventDefault()
    // Tap-to-toggle: if already on a txt path with drawer open, close it.
    if (drawerOpen && active === 'txt' && !activeManualRail) {
      onCloseDrawer?.()
      return
    }
    onTxtClick()
    // Fixed mobile "Txt" = old Captivated /hub/clients (everyone keeps it).
    // New Txt2 (/hub/txt) reaches mobile via the user slot / More picker,
    // which is gated by canAccessTxt. If already on a clients path, just open
    // the drawer; don't re-navigate (which would drop the open conversation).
    if (active !== 'txt') {
      router.push('/hub/clients')
    }
  }

  function handlePhoneClick(e: React.MouseEvent) {
    e.preventDefault()
    // Tap-to-toggle: if already on dialer with drawer open, close it.
    if (drawerOpen && active === 'dialer' && !activeManualRail) {
      onCloseDrawer?.()
      return
    }
    onPhoneClick()
    if (active !== 'dialer') {
      router.push('/hub/dialer')
    }
  }

  function wrapToggleable(slotId: string, openFn: () => void) {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      if (drawerOpen && activeManualRail === slotId) {
        onCloseDrawer?.()
        return
      }
      openFn()
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
    const showDot = slotDot(entry.id)
    const inner = (
      <>
        <span className="relative">
          {entry.icon}
          {showDot && (
            <span
              className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-400 border border-gray-950"
              aria-label="Unread"
            />
          )}
        </span>
        <span className="truncate max-w-full px-1">{entry.label}</span>
      </>
    )
    if (entry.id === 'tools') {
      return <button key="user" type="button" onClick={wrapToggleable('tools', onToolsClick)} className={cls}>{inner}</button>
    }
    if (entry.id === 'links') {
      return <button key="user" type="button" onClick={wrapToggleable('links', onLinksClick)} className={cls}>{inner}</button>
    }
    // Sidebar-backed sections (Txt2, Dialer): tap to open the drawer + navigate,
    // tap again while already there to close — same toggle as the fixed buttons.
    if (entry.href && SIDEBAR_BACKED.has(entry.id)) {
      const href = entry.href
      const onClick = (e: React.MouseEvent) => {
        e.preventDefault()
        if (drawerOpen && active === entry.id && !activeManualRail) {
          onCloseDrawer?.()
          return
        }
        onUserSlotNav?.()
        if (active !== entry.id) router.push(href)
      }
      return <button key="user" type="button" onClick={onClick} className={cls}>{inner}</button>
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
      <button
        type="button"
        onClick={handleTxtClick}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
          active === 'txt' ? 'text-amber-300' : 'text-white/60 hover:text-white'
        }`}
      >
        <CatalogIcon id="txt" />
        <span>Txt</span>
      </button>

      {/* Phone (Dialer) — only when user has access */}
      {canAccessDialer && (
        <button
          type="button"
          onClick={handlePhoneClick}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
            active === 'dialer' ? 'text-amber-300' : 'text-white/60 hover:text-white'
          }`}
          aria-label="Phone"
        >
          <span className="relative">
            <CatalogIcon id="dialer" />
            {unheardVoicemails != null && unheardVoicemails > 0 && (
              <span
                className="absolute -top-0.5 -right-1.5 min-w-[16px] h-[16px] px-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border border-gray-950"
                aria-label={`${unheardVoicemails} unheard voicemails`}
              >
                {unheardVoicemails > 9 ? '9+' : unheardVoicemails}
              </span>
            )}
          </span>
          <span>Phone</span>
        </button>
      )}

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

      {/* User-configurable slot */}
      {renderUserSlot()}

      {/* Apps — opens the full app drawer */}
      <button
        type="button"
        onClick={onMoreClick}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium text-white/60 hover:text-white"
        aria-label="Apps"
      >
        <AppsIcon />
        <span>Apps</span>
      </button>
    </nav>
  )
}
