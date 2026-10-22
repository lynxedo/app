'use client'

/**
 * The Chrome-style tab strip under the top bar. Renders only when the feature is
 * enabled AND at least one tab is open.
 *
 * Interactions: click a tab to bring it forward; the × (or a middle-click) closes
 * it; right-click for Pin / Duplicate / Open beside / Close others; Ctrl/Cmd+1..9
 * jumps to tab N; + opens the Menu; Split shows the most recent other tab beside
 * this one. Pinned tabs sit first as icons and have no ×. A dimmed tab with a
 * moon is ASLEEP (not mounted) and reopens where it was when clicked.
 */

import { useEffect, useState } from 'react'
import { useWorkspaceTabs, tabsInStripOrder, CONVERSATION_TABS, type TabCatalogId, type WorkspaceTab } from './WorkspaceTabsContext'
import { CatalogIcon, SettingsIcon, AdminIcon, type CatalogId } from '../railCatalog'
import { railFromPath } from '../HubRail'

const CATALOG_GLYPHS = new Set<string>([
  'time-clock', 'hub', 'txt2', 'activity', 'tracker', 'routing', 'fleet', 'lawn', 'dialer', 'call-log', 'time-records',
  'daily-log', 'daily-log-v2', 'files', 'company-news', 'contacts', 'marketing', 'email', 'email-inbox', 'drip',
  'pesticide-records', 'forms', 'reports', 'scoreboards', 'pricer', 'quotes', 'mix-sheet', 'feedback', 'checks',
])

// Icon for a tab. Rail/menu apps use their CatalogIcon; the extra kinds draw a
// small inline glyph.
function TabGlyph({ catalogId, href }: { catalogId: TabCatalogId; href: string }) {
  if (catalogId === 'board') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM4 9h16M9 9v10" /></svg>
  }
  if (catalogId === 'room') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" /></svg>
  }
  if (catalogId === 'dm') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>
  }
  if (catalogId === 'help') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01" /></svg>
  }
  if (catalogId === 'settings') return <SettingsIcon />
  if (catalogId === 'admin') return <AdminIcon />
  // Conversation tabs reuse their inbox's rail glyph.
  if (catalogId === 'txt-thread') return <CatalogIcon id="txt2" />
  if (catalogId === 'inbox-thread') return <CatalogIcon id="email-inbox" />
  if (CATALOG_GLYPHS.has(catalogId)) return <CatalogIcon id={catalogId as CatalogId} />
  const rail = railFromPath(href)
  if (rail === 'admin') return <AdminIcon />
  if (rail === 'settings') return <SettingsIcon />
  if (CATALOG_GLYPHS.has(rail)) return <CatalogIcon id={rail as CatalogId} />
  return <CatalogIcon id="hub" />
}

function MoonIcon() {
  return (
    <svg className="w-3 h-3 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-label="Asleep" role="img">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />
    </svg>
  )
}

export default function WorkspaceTabStrip({ onNewTab }: { onNewTab: () => void }) {
  const api = useWorkspaceTabs()
  const { enabled, tabs, activeTabId, splitTabId, awakeIds, activateTab, closeTab, evictionNotice, clearEvictionNotice } = api
  const ordered = tabsInStripOrder(tabs)
  const [menu, setMenu] = useState<{ tab: WorkspaceTab; x: number; y: number } | null>(null)

  // Ctrl/Cmd+1..9 → jump to tab N. Runs in the CAPTURE phase so it wins over the
  // rail's bubble-phase Cmd+1..4 section shortcuts — but only for indices that
  // map to an open tab, so unused numbers still fall through to the rail.
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const n = parseInt(e.key, 10)
      if (!Number.isInteger(n) || n < 1 || n > 9) return
      const tab = ordered[n - 1]
      if (!tab) return
      e.preventDefault()
      e.stopImmediatePropagation()
      activateTab(tab.id)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [enabled, ordered, activateTab])

  // Auto-dismiss the safety-cap toast.
  useEffect(() => {
    if (!evictionNotice) return
    const t = setTimeout(clearEvictionNotice, 5000)
    return () => clearTimeout(t)
  }, [evictionNotice, clearEvictionNotice])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('blur', close)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (!enabled || tabs.length === 0) return null

  const asleepCount = tabs.filter(t => !awakeIds.has(t.id)).length
  const splitOn = !!splitTabId && splitTabId !== activeTabId
  const canSplit = tabs.length > 1

  const menuItems = menu ? [
    { label: menu.tab.pinned ? 'Unpin tab' : 'Pin tab', run: () => api.setPinned(menu.tab.id, !menu.tab.pinned) },
    // A conversation is never open twice (see CONVERSATION_TABS).
    ...(!CONVERSATION_TABS.has(menu.tab.catalogId) ? [{ label: 'Duplicate', run: () => api.duplicateTab(menu.tab.id) }] : []),
    ...(canSplit ? [{ label: 'Open beside (split view)', run: () => api.setSplit(menu.tab.id) }] : []),
    ...(tabs.length > 1 ? [{ label: 'Close other tabs', run: () => api.closeOthers(menu.tab.id) }] : []),
    ...(!menu.tab.pinned ? [{ label: 'Close tab', run: () => closeTab(menu.tab.id), danger: true }] : []),
  ] : []

  return (
    <div className="hidden md:block flex-none border-b border-white/10" style={{ background: 'var(--t-well)' }}>
      <div className="flex items-end gap-1.5 px-2">
        <div role="tablist" aria-label="Open tabs" className="flex items-stretch gap-0.5 pt-1 overflow-x-auto no-scrollbar min-w-0">
          {ordered.map((t, i) => {
            const isActive = t.id === activeTabId
            const isBeside = splitOn && t.id === splitTabId
            const asleep = !awakeIds.has(t.id)
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={isActive}
                title={asleep ? `${t.label} — asleep, click to wake` : t.pinned ? `${t.label} (pinned)` : t.label}
                onClick={() => activateTab(t.id)}
                onContextMenu={e => { e.preventDefault(); setMenu({ tab: t, x: e.clientX, y: e.clientY }) }}
                onAuxClick={e => { if (e.button === 1 && !t.pinned) { e.preventDefault(); closeTab(t.id) } }}
                onMouseDown={e => { if (e.button === 1) e.preventDefault() /* suppress autoscroll */ }}
                className={[
                  'group relative flex items-center gap-1.5 py-1.5 rounded-t-lg text-[13px] leading-none cursor-pointer select-none shrink-0 transition-colors',
                  t.pinned ? 'px-2.5' : 'pl-2.5 pr-1 max-w-[210px]',
                  isActive ? 'bg-white/[0.08] text-white'
                    : isBeside ? 'bg-white/[0.05] text-white/85'
                    : asleep ? 'text-white/35 hover:text-white/70 hover:bg-white/[0.04]'
                    : 'text-white/55 hover:text-white hover:bg-white/[0.04]',
                ].join(' ')}
              >
                {/* active accent bar — brand color tracks the user's theme */}
                {(isActive || isBeside) && (
                  <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded" style={{ background: isActive ? 'var(--brand)' : 'rgba(255,255,255,.25)' }} aria-hidden="true" />
                )}
                <span
                  className="flex-none [&>svg]:w-4 [&>svg]:h-4"
                  style={isActive ? { color: 'var(--brand)' } : undefined}
                  aria-hidden="true"
                >
                  <TabGlyph catalogId={t.catalogId} href={t.href} />
                </span>
                {!t.pinned && <span className="truncate">{t.label}</span>}
                {asleep && <MoonIcon />}
                <span className="sr-only">{isActive ? '(active)' : ''}{asleep ? ' (asleep)' : ''}{i < 9 ? ` — Ctrl+${i + 1} to switch` : ''}</span>
                {!t.pinned && (
                  <button
                    type="button"
                    aria-label={`Close ${t.label}`}
                    onClick={e => { e.stopPropagation(); closeTab(t.id) }}
                    className={[
                      'ml-0.5 flex-none w-5 h-5 rounded flex items-center justify-center text-white/45 hover:text-white hover:bg-white/10 transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    ].join(' ')}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onNewTab}
          className="flex-none mb-1 w-7 h-7 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.07]"
          aria-label="Open something in a new tab"
          title="New tab (opens the Menu)"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
        </button>
        <div className="flex-1" />
        <span className="flex-none mb-2 text-[11.5px] text-white/35 whitespace-nowrap">
          {tabs.length} tab{tabs.length === 1 ? '' : 's'}{asleepCount ? ` · ${asleepCount} asleep` : ''}
        </span>
        <button
          type="button"
          disabled={!canSplit}
          onClick={() => api.setSplit(splitOn ? null : (() => {
            const others = tabs.filter(t => t.id !== activeTabId)
            return others.length ? others.reduce((a, b) => (b.lastActiveSeq > a.lastActiveSeq ? b : a)).id : null
          })())}
          aria-pressed={splitOn}
          title={splitOn ? 'Close split view' : 'Split view — show your last tab beside this one'}
          className={[
            'flex-none mb-1 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] font-medium disabled:opacity-30',
            splitOn ? 'bg-white/[0.1] text-white' : 'text-white/55 hover:text-white hover:bg-white/[0.07]',
          ].join(' ')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18v16H3zM12 4v16" /></svg>
          Split
        </button>
      </div>
      {evictionNotice && (
        <div role="status" className="px-3 py-1 text-[12px] text-amber-200 bg-amber-500/10 border-t border-amber-500/20">
          {evictionNotice}
        </div>
      )}
      {menu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }} aria-hidden="true" />
          <div
            role="menu"
            className="fixed z-[61] w-56 rounded-xl border border-white/10 bg-gray-900 shadow-2xl p-1.5"
            style={{ left: Math.min(menu.x, window.innerWidth - 232), top: menu.y + 4 }}
          >
            {menuItems.map(item => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => { setMenu(null); item.run() }}
                className={`w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-white/[0.07] ${'danger' in item && item.danger ? 'text-red-300' : 'text-white/85 hover:text-white'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
