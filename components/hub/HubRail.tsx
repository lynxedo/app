'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  CatalogIcon,
  CustomUrlIcon,
  SearchIcon,
  SettingsIcon,
  AdminIcon,
  AppsIcon,
  DndIcon,
  LockIcon,
  catalogById,
  type CatalogId,
  type RailPermissions,
} from './railCatalog'
import { classifyToken } from '@/lib/hub-layout'
import { useOnCallUsers } from './OnCallPresenceProvider'
// NAV-tokenConsistency — DM label resolution shared with the launcher, mobile
// bar, and mobile drawer (was a per-file copy that could drift).
import { convFirstNames } from './menuItem'

type Room = { id: string; name: string; is_private: boolean }
type RailConversation = { id: string; participants: { id: string; display_name: string; avatar_url?: string | null }[] }

export type RailId =
  | 'time-clock'
  | 'hub'
  | 'admin'
  | 'settings'
  | 'profile'
  | CatalogId

// Path → rail. First match wins. Used so the visited section's icon shows the
// active accent bar regardless of which slot it occupies.
const RAIL_BY_PREFIX: Array<[string, RailId]> = [
  ['/hub/home', 'hub'],          // landing page treated as hub-adjacent
  ['/hub/txt', 'txt2'],          // Twilio-backed texting ("Txt") — gated by canAccessTxt
  ['/hub/contacts', 'contacts'], // shared Contacts tool (linked from Txt + Dialer)
  ['/hub/activity', 'activity'],
  ['/hub/admin', 'admin'],
  ['/hub/settings', 'settings'],
  ['/hub/tracker', 'tracker'],
  ['/hub/marketing', 'marketing'], // Marketing roof (Email + Social + future Txt)
  ['/hub/routing', 'routing'],
  ['/hub/fleet', 'fleet'],
  ['/hub/scoreboards', 'scoreboards'],
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

export default function HubRail({
  showAdmin,
  unreadActivity: _unreadActivity, // unused — Activity is now a floating bell
  unreadHub,
  dailyLogUnread = false,
  txtUnread = false,
  missedCall = false,
  unheardVoicemails = 0,
  isClockedIn,
  onSearchClick,
  onProfileClick,
  onTimeClockClick,
  onActivityClick,
  onOpenLauncher,
  onToggleDnd,
  onToggleHubDnd,
  onToggleDialerDnd,
  masterDndOn = false,
  hubDndOn = false,
  dialerDndOn = false,
  onOpenLayoutEditor,
  currentUserId,
  currentUserDisplayName,
  currentUserAvatarUrl,
  currentUserStatus,
  collapsed: _collapsed,
  onToggleCollapsed,
  onOpenSidebar,
  activeManualRail,
  permissions,
  items,
  rooms = [],
  conversations = [],
  launcherOpen = false,
}: {
  showAdmin: boolean
  unreadActivity?: number
  unreadHub?: boolean
  /** Orange dot on the Daily Log rail slot when there are unseen v1 updates. */
  dailyLogUnread?: boolean
  /** Orange dot on the Txt2 rail icon when there are unread customer texts. */
  txtUnread?: boolean
  /** Orange dot on the Dialer rail icon when there's a new missed call. */
  missedCall?: boolean
  /** Session 58.5: red badge with count on the rail Dialer icon. */
  unheardVoicemails?: number
  isClockedIn?: boolean
  onSearchClick: () => void
  onProfileClick: () => void
  onTimeClockClick: () => void
  onActivityClick: () => void
  onOpenLauncher: () => void
  /** Toggle master DND (sys:dnd — silences everything). */
  onToggleDnd: () => void
  /** Toggle Hub notifications DND (sys:hub-dnd). */
  onToggleHubDnd?: () => void
  /** Toggle Dialer calls DND (sys:dialer-dnd). */
  onToggleDialerDnd?: () => void
  /** Current state of each DND type for rail item rendering. */
  masterDndOn?: boolean
  hubDndOn?: boolean
  dialerDndOn?: boolean
  /** Open the layout customizer modal. */
  onOpenLayoutEditor: () => void
  currentUserId?: string
  currentUserDisplayName?: string
  currentUserAvatarUrl?: string | null
  currentUserStatus?: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenSidebar: () => void
  activeManualRail?: 'profile' | 'activity' | null
  permissions: RailPermissions
  /** The one shared layout list (already permission-filtered). */
  items: string[]
  rooms?: Room[]
  conversations?: RailConversation[]
  launcherOpen?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const onCallUsers = useOnCallUsers()
  const active = railFromPath(pathname)
  // Effective rail for active-icon detection — manual overrides win for the
  // pathless rails (profile). Means clicking the same icon again can toggle
  // collapse even when the section has no URL of its own.
  const effectiveActive: RailId = (activeManualRail as RailId) ?? active

  // The rail never scrolls — it shows as many icons as fit in the available
  // height; the rest live in the Apps drawer (the expanded-rail view). The fit
  // count is measured from the container so it adapts to screen size.
  const ITEM_H = 54 // approx height of one rail item (icon + label + padding)
  const railListRef = useRef<HTMLDivElement | null>(null)
  const [fitCount, setFitCount] = useState(99)
  useEffect(() => {
    const el = railListRef.current
    if (!el) return
    const compute = () => {
      const h = el.clientHeight
      if (h > 0) setFitCount(Math.max(1, Math.floor(h / ITEM_H)))
    }
    compute()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(compute) : null
    ro?.observe(el)
    window.addEventListener('resize', compute)
    return () => { ro?.disconnect(); window.removeEventListener('resize', compute) }
  }, [])
  const visibleItems = items.slice(0, fitCount)
  const hiddenCount = Math.max(0, items.length - visibleItems.length)

  // Cmd/Ctrl + 1..4 keyboard shortcuts for the common sections.
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
        case '3': e.preventDefault(); router.push('/hub/txt'); break
        case '4': e.preventDefault(); onActivityClick(); break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [router, onTimeClockClick, onActivityClick])

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
    let last: string | null = null
    try {
      last = localStorage.getItem('hub_last_chat_route') || localStorage.getItem('hub_last_route')
    } catch {}
    if (last && last.startsWith('/hub/') && last !== '/hub/home') {
      router.push(last)
      return
    }
    router.push('/hub?source=push')
  }

  function handleProfileClick(_e: React.MouseEvent) {
    if (effectiveActive === 'profile') { onToggleCollapsed(); return }
    onOpenSidebar()
    onProfileClick()
  }

  // Used for any nav item that links elsewhere (Txt, Settings, Admin, catalog
  // items). Same icon clicked while already on it → toggle collapse and stop
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

  // On a phone call → purple, outranking every other state (S2 self dot).
  const selfOnCall = !!currentUserId && onCallUsers.has(currentUserId)
  const statusColor =
    selfOnCall ? 'bg-purple-500'
    : currentUserStatus === 'dnd' ? 'bg-red-500'
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
      <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r" style={{ background: 'linear-gradient(180deg,#38bdf8,var(--brand))', boxShadow: '0 0 10px var(--brand)' }} aria-hidden="true" />
    ) : null
  }

  const roomById = (id: string) => rooms.find(r => r.id === id)

  // Render one layout token into a rail button/link.
  function renderItem(token: string, idx: number) {
    const c = classifyToken(token)

    // ── Master DND quick-toggle ──
    if (c.kind === 'master-dnd') {
      const on = masterDndOn
      return (
        <button
          key={`master-dnd-${idx}`}
          type="button"
          onClick={onToggleDnd}
          className={railBtnClass(false)}
          title={on ? 'Master DND on — tap to turn off' : 'Master DND off — tap to turn on (silences everything)'}
          aria-pressed={on}
        >
          <span className={on ? 'text-red-400' : ''}><DndIcon /></span>
          <span>{on ? 'DND on' : 'DND'}</span>
        </button>
      )
    }

    // ── Hub notifications DND quick-toggle ──
    if (c.kind === 'hub-dnd') {
      const on = hubDndOn
      return (
        <button
          key={`hub-dnd-${idx}`}
          type="button"
          onClick={onToggleHubDnd}
          className={railBtnClass(false)}
          title={on ? 'Hub msgs DND on — tap to turn off' : 'Hub msgs DND off — tap to turn on'}
          aria-pressed={on}
        >
          <span className={on ? 'text-orange-400' : ''}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0" />
              {on && <line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} />}
            </svg>
          </span>
          <span>{on ? 'Msg DND' : 'Msg'}</span>
        </button>
      )
    }

    // ── Dialer DND quick-toggle ──
    if (c.kind === 'dialer-dnd') {
      const on = dialerDndOn
      return (
        <button
          key={`dialer-dnd-${idx}`}
          type="button"
          onClick={onToggleDialerDnd}
          className={railBtnClass(false)}
          title={on ? 'Calls DND on — tap to turn off' : 'Calls DND off — tap to turn on'}
          aria-pressed={on}
        >
          <span className={on ? 'text-orange-400' : ''}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              {on && <line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} />}
            </svg>
          </span>
          <span>{on ? 'Call DND' : 'Calls'}</span>
        </button>
      )
    }

    // ── Custom URL ──
    if (c.kind === 'url') {
      let label = c.href
      try { label = new URL(c.href).hostname.replace(/^www\./, '') } catch {}
      return (
        <a
          key={`url-${idx}`}
          href={c.href}
          target="_blank"
          rel="noopener noreferrer"
          className={railBtnClass(false)}
          title={c.href}
        >
          <CustomUrlIcon />
          <span className="truncate max-w-[58px]">{label}</span>
        </a>
      )
    }

    // ── Room shortcut ──
    if (c.kind === 'room') {
      const room = roomById(c.id)
      if (!room) return null
      const isActive = pathname === `/hub/${room.id}`
      const letter = (room.name || '#').trim().charAt(0).toUpperCase() || '#'
      return (
        <Link
          key={`room-${idx}`}
          href={`/hub/${room.id}`}
          onClick={() => onOpenSidebar()}
          className={railBtnClass(isActive)}
          title={room.name}
        >
          <ActiveBar show={isActive} />
          <span className={`relative flex items-center justify-center w-5 h-5 rounded-md text-[11px] font-bold ${isActive ? 'bg-sky-400 text-[var(--t-rail)]' : 'bg-white/15 text-white/80'}`}>
            {letter}
            {room.is_private && (
              <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-3 h-3 rounded-full bg-[var(--t-rail)] text-white/85" aria-hidden="true"><LockIcon className="w-2 h-2" /></span>
            )}
          </span>
          <span className="truncate max-w-[58px]">{room.name}</span>
        </Link>
      )
    }

    // ── DM shortcut ──
    if (c.kind === 'dm') {
      const conv = conversations.find(cv => cv.id === c.id)
      if (!conv) return null
      const isActive = pathname === `/hub/pm/${conv.id}`
      const label = convFirstNames(conv, currentUserId)
      const others = conv.participants.filter(p => p.id !== currentUserId)
      const avatarUser = others[0] ?? conv.participants[0]
      const letter = (label || '?').trim().charAt(0).toUpperCase() || '?'
      return (
        <Link
          key={`dm-${idx}`}
          href={`/hub/pm/${conv.id}`}
          onClick={() => onOpenSidebar()}
          className={railBtnClass(isActive)}
          title={label}
        >
          <ActiveBar show={isActive} />
          <span className="relative w-5 h-5 rounded-full overflow-hidden bg-gradient-to-br from-sky-600 to-sky-800 flex items-center justify-center text-white text-[11px] font-bold">
            {avatarUser?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/profile/avatar/${avatarUser.id}?v=${encodeURIComponent(avatarUser.avatar_url)}`} alt="" className="w-full h-full object-cover" />
            ) : letter}
          </span>
          <span className="truncate max-w-[58px]">{label}</span>
        </Link>
      )
    }

    // ── Catalog app / system item ──
    const id = c.id

    // Hub (home) — bespoke jump-to-last-chat + toggle behavior.
    if (id === 'hub') {
      return (
        <button
          key={`hub-${idx}`}
          type="button"
          onClick={handleHubClick}
          className={railBtnClass(active === 'hub')}
          aria-pressed={active === 'hub'}
          title="Hub"
        >
          <ActiveBar show={active === 'hub'} />
          <span className={`relative ${active === 'hub' ? 'text-sky-300' : ''}`}>
            <CatalogIcon id="hub" />
            {unreadHub && (
              <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-400 border-2 border-[var(--t-rail)]" aria-label="Unread messages" />
            )}
          </span>
          <span>Hub</span>
        </button>
      )
    }

    // Time Clock — opens the modal; green dot when clocked in.
    if (id === 'time-clock') {
      return (
        <button
          key={`clock-${idx}`}
          type="button"
          onClick={onTimeClockClick}
          className={railBtnClass(false)}
          title={isClockedIn ? 'Clocked in — tap to clock out' : 'Clock in / out'}
        >
          <span className="relative">
            <CatalogIcon id="time-clock" />
            {isClockedIn && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--t-rail)] bg-emerald-500" aria-hidden="true" />
            )}
          </span>
          <span>Clock</span>
        </button>
      )
    }

    // Txt (Twilio /hub/txt) — gated; token only present if allowed.
    if (id === 'txt2') {
      return (
        <Link
          key={`txt2-${idx}`}
          href="/hub/txt"
          onClick={handleNavLinkClick('txt2')}
          className={railBtnClass(active === 'txt2')}
          aria-current={active === 'txt2' ? 'page' : undefined}
          title="Txt — customer texting"
        >
          <ActiveBar show={active === 'txt2'} />
          <span className={`relative ${active === 'txt2' ? 'text-sky-300' : ''}`}>
            <CatalogIcon id="txt2" />
            {txtUnread && active !== 'txt2' && (
              <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-400 border-2 border-[var(--t-rail)]" aria-label="Unread texts" />
            )}
          </span>
          <span>Txt</span>
        </Link>
      )
    }

    // Dialer — gated; missed-call dot + unheard-voicemail badge.
    if (id === 'dialer') {
      return (
        <Link
          key={`dialer-${idx}`}
          href="/hub/dialer"
          onClick={handleNavLinkClick('dialer')}
          className={railBtnClass(active === 'dialer')}
          aria-current={active === 'dialer' ? 'page' : undefined}
          title={unheardVoicemails > 0 ? `Dialer — ${unheardVoicemails} unheard voicemail${unheardVoicemails === 1 ? '' : 's'}` : 'Dialer'}
        >
          <ActiveBar show={active === 'dialer'} />
          <span className={`relative ${active === 'dialer' ? 'text-sky-300' : ''}`}>
            <CatalogIcon id="dialer" />
            {missedCall && active !== 'dialer' && (
              <span className="absolute -top-0.5 -left-1 w-2 h-2 rounded-full bg-orange-400 border-2 border-[var(--t-rail)]" aria-label="Missed call" />
            )}
            {unheardVoicemails > 0 && (
              <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 border-2 border-[var(--t-rail)] text-[9px] font-bold text-white flex items-center justify-center leading-none" aria-label={`${unheardVoicemails} unheard voicemail${unheardVoicemails === 1 ? '' : 's'}`}>
                {unheardVoicemails > 9 ? '9+' : unheardVoicemails}
              </span>
            )}
          </span>
          <span>Dialer</span>
        </Link>
      )
    }

    // Generic catalog app with a real href (routing, fleet, daily-log, …).
    const entry = catalogById(id, permissions)
    if (!entry) return null
    const isActive = active === id
    const showDailyLogDot = id === 'daily-log' && dailyLogUnread && !isActive
    const body = (
      <>
        <ActiveBar show={isActive} />
        <span className={`relative ${isActive ? 'text-sky-300' : ''}`}>
          {entry.icon}
          {showDailyLogDot && (
            <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-400 border-2 border-[var(--t-rail)]" aria-label="New Daily Log updates" />
          )}
        </span>
        <span className="truncate max-w-[58px]">{entry.label}</span>
      </>
    )
    if (entry.href) {
      return (
        <Link key={`cat-${idx}`} href={entry.href} onClick={handleNavLinkClick(id)} className={railBtnClass(isActive)} title={entry.label}>{body}</Link>
      )
    }
    return (
      <button key={`cat-${idx}`} type="button" onClick={() => { onOpenSidebar() }} className={railBtnClass(isActive)} title={entry.label}>{body}</button>
    )
  }

  return (
    <nav
      className="t-sidebar-surface hidden md:flex flex-col w-16 flex-none"
      style={{ paddingTop: 'env(safe-area-inset-top, 0)', background: 'linear-gradient(180deg,var(--t-well),var(--t-rail))', borderRight: '1px solid rgba(255,255,255,.06)' }}
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

      {/* User-configurable list — shows what fits (no scroll); the rest go to
          the Apps drawer. */}
      <div ref={railListRef} className="flex-1 min-h-0 overflow-hidden py-1 flex flex-col">
        {visibleItems.map((token, idx) => renderItem(token, idx))}
      </div>

      {/* All Apps launcher + Customize */}
      <div className="flex-none border-t border-white/5 py-1">
        <button
          type="button"
          onClick={onOpenLauncher}
          className={`relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium w-full transition-colors ${
            launcherOpen ? 'text-sky-300 bg-white/[0.06]' : 'text-white/55 hover:text-white hover:bg-white/5'
          }`}
          title={hiddenCount > 0 ? `All Apps — ${hiddenCount} more` : 'All Apps'}
          aria-pressed={launcherOpen}
        >
          {launcherOpen && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r" style={{ background: 'linear-gradient(180deg,#38bdf8,var(--brand))', boxShadow: '0 0 10px var(--brand)' }} aria-hidden="true" />
          )}
          <span className="relative">
            <AppsIcon />
            {hiddenCount > 0 && !launcherOpen && (
              <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-white/20 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                {hiddenCount > 9 ? '9+' : `+${hiddenCount}`}
              </span>
            )}
          </span>
          <span>Apps</span>
        </button>
        <button
          type="button"
          onClick={onOpenLayoutEditor}
          className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium w-full text-white/55 hover:text-white hover:bg-white/5 transition-colors"
          title="Customize this rail"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>Edit</span>
        </button>
      </div>

      {/* DND quick-toggles now live in the "You" menu (ProfileSidebar). The optional
          layout-token versions (renderItem master-dnd / hub-dnd / dialer-dnd) remain
          available via the rail customizer for anyone who wants them. */}

      {/* Fixed footer: Settings, Admin (gated), You */}
      <div className="flex-none flex flex-col">
        <Link
          href="/hub/settings"
          onClick={handleNavLinkClick('settings')}
          className={railBtnClass(active === 'settings')}
          aria-current={active === 'settings' ? 'page' : undefined}
          title="Settings"
        >
          <ActiveBar show={active === 'settings'} />
          <span className={active === 'settings' ? 'text-sky-300' : ''}><SettingsIcon /></span>
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
            <span className={active === 'admin' ? 'text-sky-300' : ''}><AdminIcon /></span>
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
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--t-rail)] ${statusColor}`} aria-hidden="true" />
          </span>
          <span>You</span>
        </button>
      </div>
    </nav>
  )
}
