'use client'

/**
 * The Chrome/Sheets-style tab strip that sits atop the Hub main pane. Renders
 * only when the feature is enabled AND at least one tab is open, so the Hub is
 * byte-for-byte unchanged until a user opens their first tab.
 *
 * Interactions (locked spec): click a tab to activate; the × (or a middle-click
 * anywhere on the tab) closes it; Ctrl/Cmd+1..8 jumps to tab N. See the PRD.
 */

import { useEffect } from 'react'
import { useWorkspaceTabs } from './WorkspaceTabsContext'
import { CatalogIcon } from '../railCatalog'

export default function WorkspaceTabStrip() {
  const { enabled, tabs, activeTabId, activateTab, closeTab, evictionNotice, clearEvictionNotice } = useWorkspaceTabs()

  // Ctrl/Cmd+1..8 → jump to tab N. Runs in the CAPTURE phase so it wins over the
  // rail's bubble-phase Cmd+1..4 section shortcuts — but only for indices that
  // map to an open tab, so unused numbers still fall through to the rail.
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const n = parseInt(e.key, 10)
      if (!Number.isInteger(n) || n < 1 || n > 8) return
      const tab = tabs[n - 1]
      if (!tab) return
      e.preventDefault()
      e.stopImmediatePropagation()
      activateTab(tab.id)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [enabled, tabs, activateTab])

  // Auto-dismiss the cap-eviction toast.
  useEffect(() => {
    if (!evictionNotice) return
    const t = setTimeout(clearEvictionNotice, 4000)
    return () => clearTimeout(t)
  }, [evictionNotice, clearEvictionNotice])

  if (!enabled || tabs.length === 0) return null

  return (
    <div className="flex-none border-b border-white/10">
      <div role="tablist" aria-label="Open tabs" className="flex items-stretch gap-0.5 px-2 pt-1 overflow-x-auto no-scrollbar">
        {tabs.map((t, i) => {
          const isActive = t.id === activeTabId
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={isActive}
              title={t.label}
              onClick={() => activateTab(t.id)}
              onAuxClick={e => { if (e.button === 1) { e.preventDefault(); closeTab(t.id) } }}
              onMouseDown={e => { if (e.button === 1) e.preventDefault() /* suppress autoscroll */ }}
              className={[
                'group relative flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-t-lg text-[13px] leading-none cursor-pointer select-none shrink-0 max-w-[210px] transition-colors',
                isActive ? 'bg-white/[0.08] text-white' : 'text-white/55 hover:text-white hover:bg-white/[0.04]',
              ].join(' ')}
            >
              {/* active accent bar — brand color tracks the user's theme */}
              {isActive && (
                <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded" style={{ background: 'var(--brand)' }} aria-hidden="true" />
              )}
              <span
                className="flex-none [&>svg]:w-4 [&>svg]:h-4"
                style={isActive ? { color: 'var(--brand)' } : undefined}
                aria-hidden="true"
              >
                {t.catalogId === 'board' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM4 9h16M9 9v10" />
                  </svg>
                ) : (
                  <CatalogIcon id={t.catalogId} />
                )}
              </span>
              <span className="truncate">{t.label}</span>
              <span className="sr-only">{isActive ? '(active)' : ''} — Ctrl+{i + 1} to switch</span>
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
            </div>
          )
        })}
      </div>
      {evictionNotice && (
        <div role="status" className="px-3 py-1 text-[12px] text-amber-200 bg-amber-500/10 border-t border-amber-500/20">
          {evictionNotice}
        </div>
      )}
    </div>
  )
}
