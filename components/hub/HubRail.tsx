'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

export type RailId =
  | 'home'
  | 'chat'
  | 'txt'
  | 'activity'
  | 'tools'
  | 'links'
  | 'admin'
  | 'settings'
  | 'profile'

// Path → which rail is "active". First-match wins, so order matters.
const RAIL_BY_PREFIX: Array<[string, RailId]> = [
  ['/hub/home', 'home'],
  ['/hub/clients', 'txt'],
  ['/hub/activity', 'activity'],
  ['/hub/admin', 'admin'],
  ['/hub/settings', 'settings'],
  ['/hub/tracker', 'tools'],
  ['/hub/routing', 'tools'],
  ['/hub/fleet', 'tools'],
  ['/hub/books', 'tools'],
  ['/hub/lawn', 'tools'],
  ['/hub/call-log', 'tools'],
  ['/hub/timesheet', 'tools'],
  // Everything else under /hub → chat (rooms, DMs, boards, files, pages, daily-log)
]

export function railFromPath(pathname: string | null | undefined): RailId {
  if (!pathname) return 'chat'
  for (const [prefix, id] of RAIL_BY_PREFIX) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return id
  }
  if (pathname.startsWith('/hub')) return 'chat'
  return 'chat'
}

type RailItem = {
  id: RailId
  label: string
  href?: string
  icon: React.ReactNode
  badge?: number
  hidden?: boolean
}

function Icon({ d, fill = false }: { d: string; fill?: boolean }) {
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

// Heroicons-style paths (outline)
const ICONS = {
  search: 'M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
  home: 'M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-7h6v7h3a1 1 0 001-1V10',
  chat: 'M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4-.85L3 21l1.93-4.13A7.94 7.94 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  txt: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 14h6M9 18h4',
  activity: 'M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0',
  tools: 'M11.42 15.17L17.25 21A2.65 2.65 0 0021 17.25l-5.83-5.83m-3.75 3.75L4.5 7.5A2.65 2.65 0 014.5 3.75L9.34 8.59m1.83 6.58l-6.71 6.71M9.34 8.59L3.75 14.18',
  links: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
  admin: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z',
  settings: 'M10.325 4.317a2 2 0 013.35 0l.554.916a2 2 0 002.146.96l1.05-.224a2 2 0 012.39 2.39l-.224 1.05a2 2 0 00.96 2.146l.916.554a2 2 0 010 3.35l-.916.554a2 2 0 00-.96 2.146l.224 1.05a2 2 0 01-2.39 2.39l-1.05-.224a2 2 0 00-2.146.96l-.554.916a2 2 0 01-3.35 0l-.554-.916a2 2 0 00-2.146-.96l-1.05.224a2 2 0 01-2.39-2.39l.224-1.05a2 2 0 00-.96-2.146l-.916-.554a2 2 0 010-3.35l.916-.554a2 2 0 00.96-2.146l-.224-1.05a2 2 0 012.39-2.39l1.05.224a2 2 0 002.146-.96l.554-.916zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}

export default function HubRail({
  showAdmin,
  unreadChat,
  unreadActivity,
  unreadTxt,
  onSearchClick,
  onProfileClick,
  onToolsClick,
  onLinksClick,
  currentUserDisplayName,
  currentUserStatus,
  collapsed,
  onToggleCollapsed,
}: {
  showAdmin: boolean
  unreadChat?: number
  unreadActivity?: number
  unreadTxt?: number
  onSearchClick: () => void
  onProfileClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  currentUserDisplayName?: string
  currentUserStatus?: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const active = railFromPath(pathname)

  // Cmd/Ctrl + 1..5 keyboard shortcuts for primary sections.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.shiftKey || e.altKey) return
      switch (e.key) {
        case '1': e.preventDefault(); router.push('/hub/home'); break
        case '2': e.preventDefault(); {
          let last: string | null = null
          try { last = localStorage.getItem('hub_last_chat_route') } catch {}
          router.push(last || '/hub')
          break
        }
        case '3': e.preventDefault(); router.push('/hub/clients'); break
        case '4': e.preventDefault(); router.push('/hub/activity'); break
        case '5': e.preventDefault(); onToolsClick(); break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [router, onToolsClick])

  const items: RailItem[] = [
    { id: 'home', label: 'Home', href: '/hub/home', icon: <Icon d={ICONS.home} /> },
    { id: 'chat', label: 'Chat', icon: <Icon d={ICONS.chat} />, badge: unreadChat },
    { id: 'txt', label: 'Txt', href: '/hub/clients', icon: <Icon d={ICONS.txt} />, badge: unreadTxt },
    { id: 'activity', label: 'Activity', href: '/hub/activity', icon: <Icon d={ICONS.activity} />, badge: unreadActivity },
    { id: 'tools', label: 'Tools', icon: <Icon d={ICONS.tools} /> },
    { id: 'links', label: 'Links', icon: <Icon d={ICONS.links} /> },
    { id: 'admin', label: 'Admin', href: '/hub/admin', icon: <Icon d={ICONS.admin} />, hidden: !showAdmin },
    { id: 'settings', label: 'Settings', href: '/hub/settings', icon: <Icon d={ICONS.settings} /> },
  ]

  const statusColor =
    currentUserStatus === 'dnd' ? 'bg-red-500'
    : currentUserStatus === 'busy' ? 'bg-yellow-400'
    : currentUserStatus === 'offline' ? 'bg-gray-500'
    : 'bg-emerald-500'

  const firstInitial = (currentUserDisplayName ?? '?').trim().charAt(0).toUpperCase() || '?'

  function handleItemClick(item: RailItem, e: React.MouseEvent) {
    // Click the already-active rail icon → toggle the sidebar collapse.
    if (item.id === active && (item.id === 'chat' || item.id === 'tools' || item.id === 'links')) {
      e.preventDefault()
      onToggleCollapsed()
      return
    }
    if (item.id === 'tools') {
      e.preventDefault()
      onToolsClick()
      return
    }
    if (item.id === 'links') {
      e.preventDefault()
      onLinksClick()
      return
    }
    if (item.id === 'chat') {
      e.preventDefault()
      let last: string | null = null
      try { last = localStorage.getItem('hub_last_chat_route') } catch {}
      router.push(last || '/hub')
      return
    }
    // home/txt/activity/admin/settings have hrefs — let Link handle it.
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
        aria-label="Search"
      >
        <Icon d={ICONS.search} />
        <span>Search</span>
      </button>

      <div className="h-px bg-white/5 mx-3" />

      {/* Primary nav */}
      <div className="flex-1 flex flex-col py-1 overflow-y-auto">
        {items.filter(i => !i.hidden).map(item => {
          const isActive = active === item.id
          const className = [
            'relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
            isActive ? 'text-white' : 'text-white/55 hover:text-white hover:bg-white/5',
          ].join(' ')
          const inner = (
            <>
              {/* Active left accent bar */}
              {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-amber-400" aria-hidden="true" />}
              <span className={isActive ? 'text-amber-300' : ''}>{item.icon}</span>
              <span className="leading-tight">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className="absolute top-1 right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center" aria-label={`${item.badge} unread`}>
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </>
          )
          if (item.href) {
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={e => handleItemClick(item, e)}
                className={className}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
              >
                {inner}
              </Link>
            )
          }
          return (
            <button
              key={item.id}
              type="button"
              onClick={e => handleItemClick(item, e)}
              className={className}
              aria-pressed={isActive}
              title={item.label}
            >
              {inner}
            </button>
          )
        })}
      </div>

      {/* Profile (bottom) */}
      <button
        type="button"
        onClick={onProfileClick}
        className="relative flex flex-col items-center justify-center gap-0.5 py-3 text-[10px] font-medium text-white/55 hover:text-white hover:bg-white/5 transition-colors"
        title={currentUserDisplayName ?? 'You'}
        aria-label="Your profile"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0) + 0.75rem)' }}
      >
        <span className="relative w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-xs font-bold">
          {firstInitial}
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a1f33] ${statusColor}`} aria-hidden="true" />
        </span>
        <span>You</span>
      </button>
    </nav>
  )
}
