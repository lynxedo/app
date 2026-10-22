'use client'

// Desktop top bar, across the full width right of the rail: search in the
// middle (the same search ⌘K opens — apps, rooms, people, contacts, messages,
// Settings/Admin/Help), and New + the notification bell on the right. Hidden on
// phones, which keep their own bottom bar.

import { useEffect, useRef, useState } from 'react'
import { SearchIcon } from './railCatalog'

export default function HubTopBar({
  onSearch,
  unreadActivity,
  onBell,
  newItems,
}: {
  onSearch: () => void
  unreadActivity: number
  onBell: () => void
  newItems: { key: string; label: string; onClick: () => void }[]
}) {
  const [newOpen, setNewOpen] = useState(false)
  const newRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!newOpen) return
    const onDown = (e: MouseEvent) => {
      if (newRef.current && !newRef.current.contains(e.target as Node)) setNewOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNewOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [newOpen])

  // Read after mount so the server render and hydration agree.
  const [isMac, setIsMac] = useState(true)
  useEffect(() => { setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent)) }, [])

  return (
    // t-sidebar-surface: the top bar is nav chrome like the rail — hybrid themes
    // (Sharp, Eclipse, Pine) keep it dark with light text, light themes light.
    <div
      className="t-sidebar-surface hidden md:flex flex-none h-12 items-center gap-3 px-3 border-b border-white/10"
      style={{ background: 'var(--t-well)' }}
    >
      <div className="flex-1" />
      <button
        id="hub-topbar-search"
        type="button"
        onClick={onSearch}
        className="flex-[0_1_440px] min-w-[200px] h-8 flex items-center gap-2 px-3 rounded-lg border border-white/20 bg-white/[0.07] hover:bg-white/[0.12] text-white/75 hover:text-white text-[13px] text-left transition-colors [&_svg]:w-4 [&_svg]:h-4"
        title="Search (⌘K)"
      >
        <SearchIcon />
        <span className="flex-1 truncate">Search apps, customers, people, messages…</span>
        <kbd className="flex-none text-[10.5px] font-sans text-white/70 border border-white/25 rounded px-1.5 py-px">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <div className="flex-1" />

      <div ref={newRef} className="relative flex-none">
        <button
          type="button"
          onClick={() => setNewOpen(v => !v)}
          aria-expanded={newOpen}
          className="h-8 flex items-center gap-1.5 pl-2.5 pr-3 rounded-lg text-[13px] font-semibold text-white transition-[filter] hover:brightness-110"
          style={{ background: 'var(--brand)' }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
          New
        </button>
        {newOpen && (
          <div className="absolute right-0 top-10 z-50 w-56 rounded-xl border border-white/15 bg-gray-950 backdrop-blur-xl shadow-2xl p-1.5" role="menu">
            {newItems.map(item => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => { setNewOpen(false); item.onClick() }}
                className="w-full text-left px-3 py-2 rounded-lg text-[13px] text-white/90 hover:bg-white/[0.1] hover:text-white"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onBell}
        className="relative flex-none w-9 h-8 flex items-center justify-center rounded-lg text-white/75 hover:text-white hover:bg-white/[0.1]"
        aria-label={unreadActivity > 0 ? `Notifications — ${unreadActivity} new` : 'Notifications'}
        title="Notifications"
      >
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0" />
        </svg>
        {unreadActivity > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[9px] font-bold text-[#fff] flex items-center justify-center leading-none">
            {unreadActivity > 9 ? '9+' : unreadActivity}
          </span>
        )}
      </button>
    </div>
  )
}
