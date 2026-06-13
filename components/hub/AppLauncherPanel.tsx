'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CatalogIcon, DndIcon, catalogById, type CatalogId, type RailPermissions } from './railCatalog'
import { classifyToken } from '@/lib/hub-layout'

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
  if (c.kind === 'master-dnd') return '#f87171'
  if (c.kind === 'hub-dnd') return '#fb923c'
  if (c.kind === 'dialer-dnd') return '#fb923c'
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

export default function AppLauncherPanel({
  items,
  permissions,
  rooms,
  conversations,
  currentUserId,
  onOpenLayoutEditor,
  onClose,
  onSearch,
  onActivity,
  onProfile,
  onTools,
  onLinks,
  onTimeClock,
  onToggleDnd,
  onToggleHubDnd,
  onToggleDialerDnd,
  currentUserStatus,
  masterDndOn = false,
  hubDndOn = false,
  dialerDndOn = false,
  showAdmin,
}: {
  /** The one shared layout list (already permission-filtered). */
  items: string[]
  permissions: RailPermissions
  rooms: Room[]
  conversations: Conversation[]
  currentUserId?: string
  onOpenLayoutEditor: () => void
  onClose: () => void
  onSearch: () => void
  onActivity: () => void
  onProfile: () => void
  onTools: () => void
  onLinks: () => void
  onTimeClock: () => void
  onToggleDnd: () => void
  onToggleHubDnd?: () => void
  onToggleDialerDnd?: () => void
  currentUserStatus?: string | null
  masterDndOn?: boolean
  hubDndOn?: boolean
  dialerDndOn?: boolean
  showAdmin: boolean
}) {
  const router = useRouter()
  const [appSearch, setAppSearch] = useState('')

  function navigate(href: string) { onClose(); router.push(href) }
  function openHub() {
    onClose()
    let last: string | null = null
    try { last = localStorage.getItem('hub_last_chat_route') || localStorage.getItem('hub_last_route') } catch {}
    router.push(last && last.startsWith('/hub/') && last !== '/hub/home' ? last : '/hub?source=push')
  }

  // Resolve the same label a Tile would render, so the search filter matches what the user sees.
  function labelForToken(token: string): string | null {
    const c = classifyToken(token)
    if (c.kind === 'master-dnd') return masterDndOn ? 'DND on' : 'DND'
    if (c.kind === 'hub-dnd') return hubDndOn ? 'Msg DND on' : 'Msg DND'
    if (c.kind === 'dialer-dnd') return dialerDndOn ? 'Call DND on' : 'Call DND'
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

  // Render one list token as a launch tile.
  function Tile({ token }: { token: string }) {
    const c = classifyToken(token)
    let icon: React.ReactNode = null
    let label = ''
    let onClick: () => void = () => {}

    if (c.kind === 'master-dnd') {
      const on = masterDndOn
      icon = <span className={on ? 'text-red-400' : 'text-white/80'}><DndIcon /></span>
      label = on ? 'DND on' : 'DND'
      onClick = () => onToggleDnd()
    } else if (c.kind === 'hub-dnd') {
      const on = hubDndOn
      icon = <span className={on ? 'text-orange-400' : 'text-white/80'}>
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          {on
            ? <><path strokeLinecap="round" strokeLinejoin="round" d="M9.172 9.172A4 4 0 0116 12v2.586l2 2V16a2 2 0 01-2 2H8a2 2 0 01-2-2v-1.414l2-2V12a4 4 0 01.343-1.657M12 6V4m0 18v-2M2 2l20 20" /></>
            : <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />}
        </svg>
      </span>
      label = on ? 'Msg DND' : 'Msgs'
      onClick = () => onToggleHubDnd?.()
    } else if (c.kind === 'dialer-dnd') {
      const on = dialerDndOn
      icon = <span className={on ? 'text-orange-400' : 'text-white/80'}>
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          {on
            ? <><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /><line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" /></>
            : <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />}
        </svg>
      </span>
      label = on ? 'Call DND' : 'Calls'
      onClick = () => onToggleDialerDnd?.()
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
      else if (id === 'time-clock') { label = 'Clock'; icon = <CatalogIcon id="time-clock" />; onClick = () => { onClose(); onTimeClock() } }
      else if (id === 'tools') { label = 'Tools'; icon = <CatalogIcon id="tools" />; onClick = () => { onClose(); onTools() } }
      else if (id === 'links') { label = 'Links'; icon = <CatalogIcon id="links" />; onClick = () => { onClose(); onLinks() } }
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
      <button
        type="button"
        onClick={onClick}
        className="group w-full flex flex-col items-center justify-center gap-2 p-2.5 rounded-2xl hover:bg-white/[0.05] hover:-translate-y-0.5 transition-all"
        title={label}
      >
        <span
          className="flex items-center justify-center w-11 h-11 rounded-2xl transition-transform group-hover:scale-105 [&_svg]:w-5 [&_svg]:h-5"
          style={{ color: accent, background: accent + '1f', boxShadow: `inset 0 0 0 1px ${accent}44` }}
        >
          {icon}
        </span>
        <span className="text-[10px] font-medium text-center leading-tight text-white/65 group-hover:text-white truncate max-w-full">{label}</span>
      </button>
    )
  }

  return (
    <>
      <div className="hidden md:block fixed inset-0 z-[49]" onClick={onClose} aria-hidden="true" />

      <div className="hidden md:flex fixed left-16 top-0 bottom-0 z-50 w-72 flex-col overflow-hidden shadow-2xl" style={{ background: 'linear-gradient(180deg,#0d1a2c,#0a1422)', borderRight: '1px solid rgba(255,255,255,.08)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] flex-none" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0) + 0.75rem)' }}>
          <span className="font-semibold text-sm text-white">Your apps</span>
          <div className="flex items-center gap-1">
            <button onClick={() => { onClose(); onOpenLayoutEditor() }} className="text-sky-200/90 hover:text-white text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1" style={{ background: 'rgba(56,189,248,.12)', boxShadow: 'inset 0 0 0 1px rgba(56,189,248,.25)' }} title="Customize">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              Customize
            </button>
            <button onClick={onClose} className="text-white/50 hover:text-white p-1 rounded transition-colors" aria-label="Close app launcher">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-none px-4 pt-3">
          <div className="relative">
            <svg className="w-4 h-4 text-white/35 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              autoFocus
              value={appSearch}
              onChange={e => setAppSearch(e.target.value)}
              placeholder="Search apps…"
              className="w-full bg-white/[0.06] ring-1 ring-inset ring-white/10 focus:ring-sky-400/40 rounded-xl pl-8 pr-8 py-2 text-sm text-white placeholder-white/40 outline-none transition-shadow"
            />
            {appSearch && (
              <button onClick={() => setAppSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-0.5" aria-label="Clear search">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {items.length === 0 ? (
            <p className="text-xs text-white/40 text-center py-6">Your menu is empty — tap <strong>Customize</strong> to add apps.</p>
          ) : visibleItems.length === 0 ? (
            <p className="text-xs text-white/40 text-center py-6">No apps match &ldquo;{appSearch.trim()}&rdquo;</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 mb-2">
              {visibleItems.map((token, i) => <Tile key={`${token}-${i}`} token={token} />)}
            </div>
          )}
          {!searchQ && (
            <button
              type="button"
              onClick={() => { onClose(); onOpenLayoutEditor() }}
              className="w-full mt-2 flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border border-dashed border-white/15 text-white/55 hover:text-white hover:border-sky-400/40 hover:bg-white/[0.03] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              <span className="text-[10px] font-medium">Add / edit</span>
            </button>
          )}
        </div>

        <div className="flex-none border-t border-white/[0.07] px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            <SysBtn onClick={() => { onClose(); onSearch() }} label="Search">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </SysBtn>
            <SysBtn onClick={() => { onClose(); onActivity() }} label="Activity">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0" /></svg>
            </SysBtn>
            <SysBtn onClick={() => { onClose(); onProfile() }} label="You">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </SysBtn>
            {showAdmin && (
              <SysBtnLink href="/hub/admin" label="Admin" onNavigate={onClose}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" /></svg>
              </SysBtnLink>
            )}
            <SysBtnLink href="/hub/settings" label="Settings" onNavigate={onClose}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317a2 2 0 013.35 0l.554.916a2 2 0 002.146.96l1.05-.224a2 2 0 012.39 2.39l-.224 1.05a2 2 0 00.96 2.146l.916.554a2 2 0 010 3.35l-.916.554a2 2 0 00-.96 2.146l.224 1.05a2 2 0 01-2.39 2.39l-1.05-.224a2 2 0 00-2.146.96l-.554.916a2 2 0 01-3.35 0l-.554-.916a2 2 0 00-2.146-.96l-1.05.224a2 2 0 01-2.39-2.39l.224-1.05a2 2 0 00-.96-2.146l-.916-.554a2 2 0 010-3.35l.916-.554a2 2 0 00.96-2.146l-.224-1.05a2 2 0 012.39-2.39l1.05.224a2 2 0 002.146-.96l.554-.916zM15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </SysBtnLink>
          </div>
        </div>
      </div>
    </>
  )
}

function SysBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-inset ring-white/[0.06] transition-colors text-white/55 hover:text-white">
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}

function SysBtnLink({ href, label, onNavigate, children }: { href: string; label: string; onNavigate: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onNavigate} className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-inset ring-white/[0.06] transition-colors text-white/55 hover:text-white">
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  )
}
