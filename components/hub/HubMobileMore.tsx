'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CatalogIcon, DndIcon, catalogById, type RailPermissions } from './railCatalog'
import { classifyToken, MOBILE_VISIBLE } from '@/lib/hub-layout'

// Per-app accent colors for the launcher tiles (presentational only).
const APP_ACCENT: Record<string, string> = {
  hub: '#38bdf8', txt: '#2dd4bf', txt2: '#60a5fa', dialer: '#34d399', 'time-clock': '#fbbf24',
  'daily-log': '#fb923c', 'daily-log-v2': '#fb923c', routing: '#818cf8', reports: '#a78bfa',
  fleet: '#22d3ee', tracker: '#f472b6', books: '#10b981', marketing: '#fb7185', files: '#38bdf8',
  contacts: '#7dd3fc', forms: '#a3e635', 'pesticide-records': '#34d399', 'call-log': '#c084fc',
  'call-log2': '#c084fc', tools: '#94a3b8', 'company-news': '#f59e0b', 'zone-sizer': '#2dd4bf',
  lawn: '#a3e635', 'time-records': '#fbbf24', links: '#7dd3fc',
}
function accentForToken(token: string): string {
  const c = classifyToken(token)
  if (c.kind === 'dnd') return '#f87171'
  if (c.kind === 'url') return '#7dd3fc'
  if (c.kind === 'room') return '#818cf8'
  if (c.kind === 'dm') return '#34d399'
  return APP_ACCENT[c.id] ?? '#38bdf8'
}

type Room = { id: string; name: string; is_private: boolean }
type Conversation = { id: string; participants: { id: string; display_name: string; avatar_url?: string | null }[] }

function convFirstNames(conv: Conversation, currentUserId?: string): string {
  const others = conv.participants.filter(p => p.id !== currentUserId)
  if (others.length === 0) return conv.participants[0]?.display_name ?? 'You'
  return others.map(p => (p.display_name || '?').split(' ')[0]).join(', ')
}

export default function HubMobileMore({
  onClose,
  showAdmin,
  unreadActivity,
  onSearchClick,
  onToolsClick,
  onLinksClick,
  onProfileClick,
  onActivityClick,
  onTimeClockClick,
  onToggleDnd,
  onOpenLayoutEditor,
  permissions,
  items,
  rooms,
  conversations,
  currentUserId,
  currentUserStatus,
}: {
  onClose: () => void
  showAdmin: boolean
  unreadActivity?: number
  onSearchClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  onProfileClick: () => void
  onActivityClick: () => void
  onTimeClockClick: () => void
  onToggleDnd: () => void
  onOpenLayoutEditor: () => void
  permissions: RailPermissions
  /** The one shared layout list (already permission-filtered). */
  items: string[]
  rooms: Room[]
  conversations: Conversation[]
  currentUserId?: string
  currentUserStatus?: string | null
}) {
  const router = useRouter()
  const [appSearch, setAppSearch] = useState('')

  function navigate(href: string) { onClose(); router.push(href) }
  function openHub() {
    onClose()
    let last: string | null = null
    try { last = window.localStorage.getItem('hub_last_chat_route') || window.localStorage.getItem('hub_last_route') } catch {}
    router.push(last && last.startsWith('/hub/') && last !== '/hub/home' ? last : '/hub?source=push')
  }

  // Resolve the same label a Tile would render, so the search filter matches what the user sees.
  function labelForToken(token: string): string | null {
    const c = classifyToken(token)
    if (c.kind === 'dnd') return currentUserStatus === 'dnd' ? 'DND on' : 'DND'
    if (c.kind === 'url') { try { return new URL(c.href).hostname.replace(/^www\./, '') } catch { return c.href } }
    if (c.kind === 'room') return rooms.find(r => r.id === c.id)?.name ?? null
    if (c.kind === 'dm') {
      const conv = conversations.find(cv => cv.id === c.id)
      return conv ? convFirstNames(conv, currentUserId) : null
    }
    const id = c.id
    if (id === 'hub') return 'Hub'
    if (id === 'txt') return 'Txt'
    if (id === 'time-clock') return 'Clock'
    if (id === 'tools') return 'Tools'
    if (id === 'links') return 'Links'
    return catalogById(id, permissions)?.label ?? null
  }

  const searchQ = appSearch.trim().toLowerCase()
  const visibleItems = searchQ
    ? items.filter(t => (labelForToken(t) ?? '').toLowerCase().includes(searchQ))
    : items

  function Tile({ token }: { token: string }) {
    const c = classifyToken(token)
    let icon: React.ReactNode = null
    let label = ''
    let onClick: () => void = () => {}

    if (c.kind === 'dnd') {
      const on = currentUserStatus === 'dnd'
      icon = <span className={on ? 'text-red-400' : 'text-white/80'}><DndIcon /></span>
      label = on ? 'DND on' : 'DND'
      onClick = () => onToggleDnd()
    } else if (c.kind === 'url') {
      try { label = new URL(c.href).hostname.replace(/^www\./, '') } catch { label = c.href }
      icon = <span className="text-white/80"><CatalogIcon id="links" /></span>
      onClick = () => { onClose(); window.open(c.href, '_blank', 'noopener') }
    } else if (c.kind === 'room') {
      const room = rooms.find(r => r.id === c.id)
      if (!room) return null
      label = room.name
      icon = <span className="flex items-center justify-center w-5 h-5 rounded-md bg-white/15 text-white/80 text-[11px] font-bold">{(room.name || '#').trim().charAt(0).toUpperCase() || '#'}</span>
      onClick = () => navigate(`/hub/${room.id}`)
    } else if (c.kind === 'dm') {
      const conv = conversations.find(cv => cv.id === c.id)
      if (!conv) return null
      label = convFirstNames(conv, currentUserId)
      icon = <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-700 text-white text-[11px] font-bold">{label.trim().charAt(0).toUpperCase() || '?'}</span>
      onClick = () => navigate(`/hub/pm/${conv.id}`)
    } else {
      const id = c.id
      if (id === 'hub') { label = 'Hub'; icon = <CatalogIcon id="hub" />; onClick = openHub }
      else if (id === 'txt') { label = 'Txt'; icon = <CatalogIcon id="txt" />; onClick = () => navigate('/hub/clients') }
      else if (id === 'time-clock') { label = 'Clock'; icon = <CatalogIcon id="time-clock" />; onClick = () => { onClose(); onTimeClockClick() } }
      else if (id === 'tools') { label = 'Tools'; icon = <CatalogIcon id="tools" />; onClick = () => onToolsClick() }
      else if (id === 'links') { label = 'Links'; icon = <CatalogIcon id="links" />; onClick = () => onLinksClick() }
      else {
        const entry = catalogById(id, permissions)
        if (!entry) return null
        label = entry.label
        icon = <CatalogIcon id={id} />
        onClick = entry.href ? () => navigate(entry.href!) : () => {}
      }
    }

    const accent = accentForToken(token)
    return (
      <button type="button" onClick={onClick} className="group w-full flex flex-col items-center justify-center gap-2 py-3 rounded-2xl hover:bg-white/[0.05] active:scale-95 transition-all">
        <span className="flex items-center justify-center w-12 h-12 rounded-2xl [&_svg]:w-5 [&_svg]:h-5" style={{ color: accent, background: accent + '1f', boxShadow: `inset 0 0 0 1px ${accent}44` }}>{icon}</span>
        <span className="text-[10px] font-medium text-center leading-tight px-1 text-white/70 truncate max-w-full">{label}</span>
      </button>
    )
  }

  return (
    <div className="md:hidden fixed inset-0 z-[60] bg-black/70 flex flex-col" onClick={onClose}>
      <div
        className="mt-auto text-white rounded-t-3xl overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh', paddingBottom: 'env(safe-area-inset-bottom, 0)', background: 'linear-gradient(180deg,#11233a,#0c1626)', boxShadow: '0 -20px 50px -20px rgba(0,0,0,.7)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-none">
          <span className="font-semibold text-base">Your apps</span>
          <div className="flex items-center gap-2">
            <button onClick={() => { onClose(); onOpenLayoutEditor() }} className="text-sm font-medium px-3 py-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              Customize
            </button>
            <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors" aria-label="Close">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-none px-4 pt-3">
          <div className="relative">
            <svg className="w-4 h-4 text-white/35 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="search"
              value={appSearch}
              onChange={e => setAppSearch(e.target.value)}
              placeholder="Search apps…"
              className="w-full bg-white/[0.06] ring-1 ring-inset ring-white/10 focus:ring-sky-400/40 rounded-xl pl-9 pr-9 py-2.5 text-base text-white placeholder-white/40 outline-none transition-shadow"
            />
            {appSearch && (
              <button onClick={() => setAppSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-1" aria-label="Clear search">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-4">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-2">
            Your menu{!searchQ && items.length > MOBILE_VISIBLE ? ` — first ${MOBILE_VISIBLE} show on the bar` : ''}
          </p>
          {searchQ && visibleItems.length === 0 && (
            <p className="text-xs text-white/40 text-center py-6">No apps match &ldquo;{appSearch.trim()}&rdquo;</p>
          )}
          <div className="grid grid-cols-4 gap-2.5 mb-2">
            {visibleItems.map((token, i) => <Tile key={`${token}-${i}`} token={token} />)}
            {!searchQ && (
              <button
                type="button"
                onClick={() => { onClose(); onOpenLayoutEditor() }}
                className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border border-dashed border-white/15 text-white/55 active:scale-95 transition-transform"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                <span className="text-[10px] font-medium">Add</span>
              </button>
            )}
          </div>

          <div className="h-px bg-white/10 my-4" />
          <div className="grid grid-cols-3 gap-2">
            <SysTile onClick={onSearchClick} label="Search">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </SysTile>
            <SysTile onClick={onActivityClick} label="Activity" badge={unreadActivity}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0" /></svg>
            </SysTile>
            <SysTile onClick={onProfileClick} label="You">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </SysTile>
            {showAdmin && (
              <SysTileLink href="/hub/admin" label="Admin" onNavigate={onClose}>
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" /></svg>
              </SysTileLink>
            )}
            <SysTileLink href="/hub/settings" label="Settings" onNavigate={onClose}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317a2 2 0 013.35 0l.554.916a2 2 0 002.146.96l1.05-.224a2 2 0 012.39 2.39l-.224 1.05a2 2 0 00.96 2.146l.916.554a2 2 0 010 3.35l-.916.554a2 2 0 00-.96 2.146l.224 1.05a2 2 0 01-2.39 2.39l-1.05-.224a2 2 0 00-2.146.96l-.554.916a2 2 0 01-3.35 0l-.554-.916a2 2 0 00-2.146-.96l-1.05.224a2 2 0 01-2.39-2.39l.224-1.05a2 2 0 00-.96-2.146l-.916-.554a2 2 0 010-3.35l.916-.554a2 2 0 00.96-2.146l-.224-1.05a2 2 0 012.39-2.39l1.05.224a2 2 0 002.146-.96l.554-.916zM15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </SysTileLink>
            <SysTileLink href="/help" label="Help" onNavigate={onClose}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </SysTileLink>
          </div>
        </div>
      </div>
    </div>
  )
}

function SysTile({ onClick, label, badge, children }: { onClick: () => void; label: string; badge?: number; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="relative flex flex-col items-center justify-center gap-1 py-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-inset ring-white/[0.06] transition-colors text-white/70 hover:text-white">
      {children}
      <span className="text-xs font-medium">{label}</span>
      {badge != null && badge > 0 && (
        <span className="absolute top-2 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  )
}

function SysTileLink({ href, label, onNavigate, children }: { href: string; label: string; onNavigate: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onNavigate} className="flex flex-col items-center justify-center gap-1 py-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-inset ring-white/[0.06] transition-colors text-white/70 hover:text-white">
      {children}
      <span className="text-xs font-medium">{label}</span>
    </Link>
  )
}
