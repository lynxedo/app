'use client'

/**
 * Workspace Tabs — shell-level tab state (desktop, behind the `workspace_tabs`
 * beta flag). Holds the ordered set of open Hub tabs + which one is active, and
 * KEEPS EACH ONE MOUNTED so flipping between tabs never loses scroll / filters /
 * an open drawer / a half-typed input. See Hub/HUB_WORKSPACE_TABS_PRD.md.
 *
 * The state lives here (owned by HubShell via `useWorkspaceTabsState`) and is
 * distributed to descendants (the rail, the tab strip, the app drawer) through
 * `WorkspaceTabsProvider` — mirroring how `BetaFlagsProvider` distributes the
 * beta-flag map. HubShell needs the raw state itself (to compute the active
 * sidebar + render the kept-alive stack), which is why the state is a hook it
 * calls directly rather than internal provider state.
 *
 * When `enabled` is false (mobile, or the flag off) this is inert: no tab can be
 * opened, `activeTabId` stays null, and the Hub behaves exactly as it does today.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CatalogId } from '../railCatalog'

/** Locked decision: up to 8 tabs; opening a 9th evicts the least-recently-used. */
export const MAX_WORKSPACE_TABS = 8

export type WorkspaceTab = {
  /**
   * Stable tab id. Single-instance screens use their `catalogId` (e.g.
   * `contacts`). Per-instance screens (a specific Scoreboard slug / Board id)
   * use `${catalogId}:${instanceKey}`. An explicit "new copy" of an already-open
   * screen gets a `~N` suffix so two copies can coexist.
   */
  id: string
  catalogId: CatalogId
  /** Per-instance identifier (Scoreboards slug, Boards boardId). Undefined for single-instance screens. */
  instanceKey?: string
  label: string
  href: string
  /** LRU bookkeeping — a monotonic counter bumped on activate. Higher = more recently used. */
  lastActiveSeq: number
}

export type OpenTabInput = {
  catalogId: CatalogId
  label: string
  href: string
  instanceKey?: string
  /** Alt-click gesture — force a second copy instead of jumping to the existing tab. */
  newCopy?: boolean
}

export type WorkspaceTabsApi = {
  enabled: boolean
  tabs: WorkspaceTab[]
  activeTabId: string | null
  activeTab: WorkspaceTab | null
  /** Open (or jump to) a tab. Go-to-existing unless `newCopy`. No-op when disabled. */
  openTab: (input: OpenTabInput) => void
  activateTab: (id: string) => void
  closeTab: (id: string) => void
  /** Show the underlying Next route instead of any tab (called on real navigation). */
  showRoute: () => void
  isOpen: (catalogId: CatalogId, instanceKey?: string) => boolean
  /** Transient toast text set when the 8-cap evicts a tab; the strip shows + auto-clears it. */
  evictionNotice: string | null
  clearEvictionNotice: () => void
}

function tabIdFor(catalogId: CatalogId, instanceKey?: string): string {
  return instanceKey ? `${catalogId}:${instanceKey}` : catalogId
}

/**
 * The state engine. Called ONCE by HubShell. Uses refs mirrored from state so
 * event handlers read the latest tabs/active-id without stale closures and
 * without nesting setState calls inside updaters.
 */
export function useWorkspaceTabsState(enabled: boolean): WorkspaceTabsApi {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [evictionNotice, setEvictionNotice] = useState<string | null>(null)

  const tabsRef = useRef<WorkspaceTab[]>([])
  const activeIdRef = useRef<string | null>(null)
  const seqRef = useRef(0)
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeIdRef.current = activeTabId }, [activeTabId])

  const activateTab = useCallback((id: string) => {
    const prev = tabsRef.current
    if (!prev.some(t => t.id === id)) return
    const seq = ++seqRef.current
    const next = prev.map(t => (t.id === id ? { ...t, lastActiveSeq: seq } : t))
    tabsRef.current = next
    setTabs(next)
    setActiveTabId(id)
  }, [])

  const openTab = useCallback((input: OpenTabInput) => {
    if (!enabled) return
    const prev = tabsRef.current
    const baseId = tabIdFor(input.catalogId, input.instanceKey)

    // Locked decision: clicking an app that's already open jumps to it — unless
    // Alt-click forced a new copy.
    if (!input.newCopy) {
      const existing = prev.find(t => t.id === baseId)
      if (existing) { activateTab(existing.id); return }
    }

    // Disambiguate an explicit second copy (or an id collision) with a ~N suffix.
    let id = baseId
    if (prev.some(t => t.id === id)) {
      let n = 2
      while (prev.some(t => t.id === `${baseId}~${n}`)) n++
      id = `${baseId}~${n}`
    }

    const seq = ++seqRef.current
    const newTab: WorkspaceTab = {
      id,
      catalogId: input.catalogId,
      instanceKey: input.instanceKey,
      label: input.label,
      href: input.href,
      lastActiveSeq: seq,
    }
    let next = [...prev, newTab]

    // 8-cap → evict the least-recently-used of the OTHER tabs (never the new one).
    if (next.length > MAX_WORKSPACE_TABS) {
      const lru = next
        .filter(t => t.id !== id)
        .reduce((a, b) => (b.lastActiveSeq < a.lastActiveSeq ? b : a))
      next = next.filter(t => t.id !== lru.id)
      setEvictionNotice(`Tab limit is ${MAX_WORKSPACE_TABS} — closed ${lru.label}.`)
    }

    tabsRef.current = next
    setTabs(next)
    setActiveTabId(id)
  }, [enabled, activateTab])

  const closeTab = useCallback((id: string) => {
    const prev = tabsRef.current
    const idx = prev.findIndex(t => t.id === id)
    if (idx === -1) return
    let next = prev.filter(t => t.id !== id)

    let newActiveId = activeIdRef.current
    if (activeIdRef.current === id) {
      if (next.length === 0) {
        newActiveId = null
      } else {
        // Prefer the neighbor to the right, else the left.
        const neighbor = next[idx] ?? next[idx - 1] ?? next[next.length - 1]
        newActiveId = neighbor ? neighbor.id : null
        if (newActiveId) {
          const seq = ++seqRef.current
          next = next.map(t => (t.id === newActiveId ? { ...t, lastActiveSeq: seq } : t))
        }
      }
    }

    tabsRef.current = next
    setTabs(next)
    setActiveTabId(newActiveId)
  }, [])

  const showRoute = useCallback(() => { setActiveTabId(null) }, [])

  const isOpen = useCallback(
    (catalogId: CatalogId, instanceKey?: string) => tabsRef.current.some(t => t.id === tabIdFor(catalogId, instanceKey)),
    [],
  )

  const clearEvictionNotice = useCallback(() => setEvictionNotice(null), [])

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  )

  return useMemo<WorkspaceTabsApi>(() => ({
    enabled,
    tabs,
    activeTabId,
    activeTab,
    openTab,
    activateTab,
    closeTab,
    showRoute,
    isOpen,
    evictionNotice,
    clearEvictionNotice,
  }), [enabled, tabs, activeTabId, activeTab, openTab, activateTab, closeTab, showRoute, isOpen, evictionNotice, clearEvictionNotice])
}

// ── Context distribution ────────────────────────────────────────────────────

const DISABLED_API: WorkspaceTabsApi = {
  enabled: false,
  tabs: [],
  activeTabId: null,
  activeTab: null,
  openTab: () => {},
  activateTab: () => {},
  closeTab: () => {},
  showRoute: () => {},
  isOpen: () => false,
  evictionNotice: null,
  clearEvictionNotice: () => {},
}

const WorkspaceTabsCtx = createContext<WorkspaceTabsApi | null>(null)

export function WorkspaceTabsProvider({ api, children }: { api: WorkspaceTabsApi; children: ReactNode }) {
  return <WorkspaceTabsCtx.Provider value={api}>{children}</WorkspaceTabsCtx.Provider>
}

/** Read the tab api. Returns an inert disabled api if used outside a provider (e.g. mobile). */
export function useWorkspaceTabs(): WorkspaceTabsApi {
  return useContext(WorkspaceTabsCtx) ?? DISABLED_API
}
