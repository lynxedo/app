'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { railFromPath } from './HubRail'
import {
  CatalogIcon,
  AppsIcon,
  DndIcon,
  catalogById,
  type RailPermissions,
  type CatalogId,
} from './railCatalog'
import { classifyToken } from '@/lib/hub-layout'

type Room = { id: string; name: string; is_private: boolean }

// The bottom bar physically fits ~5 icons before the Apps escape hatch. Extra
// mobile-layout items overflow into the Apps drawer; the editor warns about it.
const MAX_MOBILE_ITEMS = 5

export default function HubMobileBar({
  onMoreClick,
  onHubClick,
  onTxtClick,
  onPhoneClick,
  onUserSlotNav,
  onTimeClockClick,
  onToolsClick,
  onLinksClick,
  onToggleDnd,
  isClockedIn,
  unreadHub,
  unheardVoicemails,
  txtUnread,
  missedCall,
  dailyLogUnread,
  permissions,
  mobileItems,
  rooms = [],
  currentUserStatus,
  hidden,
  drawerOpen,
  activeManualRail,
  onCloseDrawer,
}: {
  onMoreClick: () => void
  onHubClick: () => void
  onTxtClick: () => void
  onPhoneClick: () => void
  /** Open the mobile drawer for a sidebar-backed item (Txt2 / Dialer). */
  onUserSlotNav?: () => void
  onTimeClockClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  onToggleDnd: () => void
  isClockedIn?: boolean
  unreadHub?: boolean
  unheardVoicemails?: number
  txtUnread?: boolean
  missedCall?: boolean
  dailyLogUnread?: boolean
  permissions: RailPermissions
  /** Ordered mobile layout tokens (already permission-filtered). */
  mobileItems: string[]
  rooms?: Room[]
  currentUserStatus?: string | null
  hidden?: boolean
  drawerOpen?: boolean
  activeManualRail?: string | null
  onCloseDrawer?: () => void
}) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const active = railFromPath(pathname)

  const items = mobileItems.slice(0, MAX_MOBILE_ITEMS)

  const SIDEBAR_BACKED = new Set<CatalogId>(['txt2', 'dialer'])
  const roomById = (id: string) => rooms.find(r => r.id === id)

  function handleHubClick(e: React.MouseEvent) {
    e.preventDefault()
    if (drawerOpen && active === 'hub' && !activeManualRail) { onCloseDrawer?.(); return }
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
    if (drawerOpen && active === 'txt' && !activeManualRail) { onCloseDrawer?.(); return }
    onTxtClick()
    if (active !== 'txt') router.push('/hub/clients')
  }

  function handlePhoneClick(e: React.MouseEvent) {
    e.preventDefault()
    if (drawerOpen && active === 'dialer' && !activeManualRail) { onCloseDrawer?.(); return }
    onPhoneClick()
    if (active !== 'dialer') router.push('/hub/dialer')
  }

  function wrapToggleable(slotId: string, openFn: () => void) {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      if (drawerOpen && activeManualRail === slotId) { onCloseDrawer?.(); return }
      openFn()
    }
  }

  const btn = (isActive: boolean) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
      isActive ? 'text-amber-300' : 'text-white/60 hover:text-white'
    }`

  function dot(extra = false) {
    if (!extra) return null
    return <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-400 border border-gray-950" aria-label="Unread" />
  }

  function renderItem(token: string, idx: number) {
    const c = classifyToken(token)

    if (c.kind === 'dnd') {
      const on = currentUserStatus === 'dnd'
      return (
        <button key={`dnd-${idx}`} type="button" onClick={onToggleDnd} className={btn(false)} aria-pressed={on}>
          <span className={on ? 'text-red-400' : ''}><DndIcon /></span>
          <span>{on ? 'DND on' : 'DND'}</span>
        </button>
      )
    }

    if (c.kind === 'url') {
      let label = c.href
      try { label = new URL(c.href).hostname.replace(/^www\./, '') } catch {}
      return (
        <a key={`url-${idx}`} href={c.href} target="_blank" rel="noopener noreferrer" className={btn(false)}>
          <CatalogIcon id="links" />
          <span className="truncate max-w-full px-1">{label}</span>
        </a>
      )
    }

    if (c.kind === 'room') {
      const room = roomById(c.id)
      if (!room) return null
      const isActive = pathname === `/hub/${room.id}`
      const letter = (room.name || '#').trim().charAt(0).toUpperCase() || '#'
      return (
        <Link key={`room-${idx}`} href={`/hub/${room.id}`} onClick={() => onUserSlotNav?.()} className={btn(isActive)}>
          <span className={`flex items-center justify-center w-5 h-5 rounded-md text-[11px] font-bold ${isActive ? 'bg-amber-400 text-gray-950' : 'bg-white/15 text-white/80'}`}>{letter}</span>
          <span className="truncate max-w-full px-1">{room.name}</span>
        </Link>
      )
    }

    if (c.kind === 'dm') return null

    const id = c.id

    if (id === 'hub') {
      return (
        <button key={`hub-${idx}`} type="button" onClick={handleHubClick} className={btn(active === 'hub')}>
          <span className="relative"><CatalogIcon id="hub" />{dot(!!unreadHub)}</span>
          <span>Hub</span>
        </button>
      )
    }
    if (id === 'txt') {
      return (
        <button key={`txt-${idx}`} type="button" onClick={handleTxtClick} className={btn(active === 'txt')}>
          <CatalogIcon id="txt" />
          <span>Txt</span>
        </button>
      )
    }
    if (id === 'dialer') {
      return (
        <button key={`dialer-${idx}`} type="button" onClick={handlePhoneClick} className={btn(active === 'dialer')} aria-label="Phone">
          <span className="relative">
            <CatalogIcon id="dialer" />
            {missedCall && active !== 'dialer' && (
              <span className="absolute -top-0.5 -left-1 w-2 h-2 rounded-full bg-orange-400 border border-gray-950" aria-label="Missed call" />
            )}
            {unheardVoicemails != null && unheardVoicemails > 0 && (
              <span className="absolute -top-0.5 -right-1.5 min-w-[16px] h-[16px] px-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border border-gray-950" aria-label={`${unheardVoicemails} unheard voicemails`}>
                {unheardVoicemails > 9 ? '9+' : unheardVoicemails}
              </span>
            )}
          </span>
          <span>Phone</span>
        </button>
      )
    }
    if (id === 'time-clock') {
      return (
        <button key={`clock-${idx}`} type="button" onClick={onTimeClockClick} className={btn(false)} aria-label="Time clock">
          <span className="relative">
            <CatalogIcon id="time-clock" />
            {isClockedIn && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-gray-950 bg-emerald-500" aria-hidden="true" />
            )}
          </span>
          <span>Clock</span>
        </button>
      )
    }
    if (id === 'txt2') {
      const onClick = (e: React.MouseEvent) => {
        e.preventDefault()
        if (drawerOpen && active === 'txt2' && !activeManualRail) { onCloseDrawer?.(); return }
        onUserSlotNav?.()
        if (active !== 'txt2') router.push('/hub/txt')
      }
      return (
        <button key={`txt2-${idx}`} type="button" onClick={onClick} className={btn(active === 'txt2')}>
          <span className="relative"><CatalogIcon id="txt2" />{dot(!!txtUnread && active !== 'txt2')}</span>
          <span>Txt2</span>
        </button>
      )
    }
    if (id === 'tools') {
      return (
        <button key={`tools-${idx}`} type="button" onClick={wrapToggleable('tools', onToolsClick)} className={btn(false)}>
          <CatalogIcon id="tools" />
          <span>Tools</span>
        </button>
      )
    }
    if (id === 'links') {
      return (
        <button key={`links-${idx}`} type="button" onClick={wrapToggleable('links', onLinksClick)} className={btn(false)}>
          <CatalogIcon id="links" />
          <span>Links</span>
        </button>
      )
    }
    if (SIDEBAR_BACKED.has(id)) {
      // Any remaining sidebar-backed id (none beyond txt2/dialer today).
      const entry = catalogById(id, permissions)
      if (!entry || !entry.href) return null
      const href = entry.href
      const onClick = (e: React.MouseEvent) => {
        e.preventDefault()
        if (drawerOpen && active === id && !activeManualRail) { onCloseDrawer?.(); return }
        onUserSlotNav?.()
        if (active !== id) router.push(href)
      }
      return (
        <button key={`sb-${idx}`} type="button" onClick={onClick} className={btn(active === id)}>
          <CatalogIcon id={id} />
          <span className="truncate max-w-full px-1">{entry.label}</span>
        </button>
      )
    }

    const entry = catalogById(id, permissions)
    if (!entry || !entry.href) return null
    const isActive = active === id
    const showDot = id === 'daily-log' && !!dailyLogUnread && !isActive
    return (
      <Link key={`cat-${idx}`} href={entry.href} className={btn(isActive)}>
        <span className="relative">{entry.icon}{dot(showDot)}</span>
        <span className="truncate max-w-full px-1">{entry.label}</span>
      </Link>
    )
  }

  return (
    <nav
      className={`md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch border-t border-gray-800 bg-gray-950 transition-transform duration-200 ${hidden ? 'translate-y-full' : 'translate-y-0'}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      aria-label="Hub bottom navigation"
    >
      {items.map((token, idx) => renderItem(token, idx))}

      {/* Apps — always present; the escape hatch + overflow for hidden items. */}
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
