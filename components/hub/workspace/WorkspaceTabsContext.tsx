'use client'

/**
 * Workspace Tabs — shell-level tab state (desktop only; graduated out of beta
 * Aug 13 2026). Holds the ordered set of open Hub tabs + which one is active, and
 * KEEPS EACH AWAKE ONE MOUNTED so flipping between tabs never loses scroll /
 * filters / an open drawer / a half-typed input. See Hub/HUB_WORKSPACE_TABS_PRD.md.
 *
 * Since Oct 22 2026 (the "Hub as an operating system" build) EVERYTHING opens in
 * a tab. Three kinds of tab content, decided by HubShell:
 *   - a TWIN   — a kept-alive client component for the screen (Contacts, Tracker,
 *                rooms/DMs, Txt/Inbox threads, Scoreboards, …), `kind` undefined;
 *   - the ROUTE — the one page tab bound to the Next route the window is showing
 *                (`routeTabId`); its content is the layout's `children`;
 *   - a FRAME  — any other page tab: the real route in a same-origin frame
 *                running the embedded shell (lib/hub-embed.ts).
 *
 * No hard tab cap any more: only the MAX_AWAKE_TABS most recently used tabs stay
 * mounted; the rest SLEEP (unmounted, shown dimmed) and wake — reloaded at their
 * last href — when clicked. Tabs are remembered per user in localStorage and come
 * back after a refresh.
 *
 * The state lives here (owned by HubShell via `useWorkspaceTabsState`) and is
 * distributed to descendants (the rail, the tab strip, the menu) through
 * `WorkspaceTabsProvider`.
 *
 * When `enabled` is false (mobile, or the user switched tabs off in Hub Settings
 * → My Hub) this is inert: no tab can be opened, `activeTabId` stays null, any
 * tabs already open are closed, and the Hub behaves exactly as it did before tabs.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import type { CatalogId } from '../railCatalog'
import { appKeyFromPath } from '@/lib/hub-embed'

/** Tabs kept mounted at once; older ones sleep until clicked. */
export const MAX_AWAKE_TABS = 6
/** Safety net only — far past what anyone keeps open. Past it the least-recently-used unpinned tab closes. */
export const MAX_OPEN_TABS = 40

/** Stable empty list for the disabled case — a fresh `[]` would churn every memo keyed on `tabs`. */
const EMPTY_TABS: WorkspaceTab[] = []
const EMPTY_SET: ReadonlySet<string> = new Set()

/**
 * Which app a tab represents. Rail/menu apps are `CatalogId`; the extras are
 * screens with no rail-catalog entry (a Board, a room, a DM, a single Txt/Inbox
 * conversation, Admin, Settings, and 'page' for any other Hub page).
 */
export type TabCatalogId = CatalogId | 'board' | 'room' | 'dm' | 'txt-thread' | 'inbox-thread' | 'admin' | 'settings' | 'help' | 'page'

/**
 * Tabs that are ONE live conversation. Never duplicated: a second copy would be
 * a second subscriber on the same feed topic, which throws.
 */
export const CONVERSATION_TABS: ReadonlySet<TabCatalogId> = new Set<TabCatalogId>(['room', 'dm', 'txt-thread', 'inbox-thread'])

export type WorkspaceTab = {
  /**
   * Stable tab id. Twins use their `catalogId` (e.g. `contacts`) or
   * `${catalogId}:${instanceKey}` for per-instance screens; page tabs get a
   * generated `p<n>` id because their href moves as you navigate inside them.
   * An explicit "new copy" gets a `~N` suffix so two copies can coexist.
   */
  id: string
  catalogId: TabCatalogId
  /** Per-instance identifier (Scoreboards slug, Board id, conversation id). */
  instanceKey?: string
  label: string
  /** Where the tab is right now (page tabs update this as you navigate inside them). */
  href: string
  /** LRU bookkeeping — a monotonic counter bumped on activate. Higher = more recently used. */
  lastActiveSeq: number
  /** 'page' = the real route (bound to the window's route, or in a frame). Undefined = a twin. */
  kind?: 'page'
  pinned?: boolean
  /** Restored from a previous visit and not opened yet this visit — asleep until clicked. */
  restored?: boolean
}

export type OpenTabInput = {
  catalogId: TabCatalogId
  label: string
  href: string
  instanceKey?: string
  kind?: 'page'
  /** Alt-click gesture — force a second copy instead of jumping to the existing tab. */
  newCopy?: boolean
  /** Bring it to the front (default). False opens/finds it without switching. */
  activate?: boolean
}

export type WorkspaceTabsApi = {
  enabled: boolean
  tabs: WorkspaceTab[]
  activeTabId: string | null
  activeTab: WorkspaceTab | null
  /** The page tab whose content is the window's own Next route (`children`). */
  routeTabId: string | null
  /** The tab shown beside the active one (split view), or null. */
  splitTabId: string | null
  /** Tabs that are mounted right now. Everything else is asleep. */
  awakeIds: ReadonlySet<string>
  /** Open (or jump to) a tab. Go-to-existing (same id, or same href) unless `newCopy`. Returns its id. */
  openTab: (input: OpenTabInput) => string | null
  /** Rail / menu: jump to the most recently used tab of this app, else open `input`. */
  openApp: (input: OpenTabInput) => string | null
  activateTab: (id: string) => void
  /**
   * If a tab whose `href` matches is already open, activate it and return true;
   * otherwise return false. No-op → false when disabled.
   */
  activateByHref: (href: string) => boolean
  findByHref: (href: string) => WorkspaceTab | null
  closeTab: (id: string) => void
  closeOthers: (id: string) => void
  duplicateTab: (id: string) => void
  setPinned: (id: string, pinned: boolean) => void
  /** A page tab moved (or learned its title). */
  updateTab: (id: string, patch: { href?: string; label?: string }) => void
  /** Bind a page tab to the window's route (null unbinds; the old one becomes a frame). */
  bindRoute: (id: string | null) => void
  setSplit: (id: string | null) => void
  /** Legacy: show the route tab (if any). */
  showRoute: () => void
  isOpen: (catalogId: TabCatalogId, instanceKey?: string) => boolean
  /** Transient toast text set when the safety cap closes a tab; the strip shows + auto-clears it. */
  evictionNotice: string | null
  clearEvictionNotice: () => void
  /** The live state (refs), for effects that run in the same commit as a change. */
  peek: () => { tabs: WorkspaceTab[]; activeTabId: string | null; routeTabId: string | null; splitTabId: string | null }
}

function tabIdFor(catalogId: TabCatalogId, instanceKey?: string): string {
  return instanceKey ? `${catalogId}:${instanceKey}` : catalogId
}

/** Hrefs compare without a trailing slash; the query string counts. */
function sameHref(a: string, b: string): boolean {
  const n = (h: string) => (h.length > 1 && h.endsWith('/') ? h.slice(0, -1) : h)
  return n(a) === n(b)
}

type StoredTabs = {
  v: 1
  tabs: { id: string; catalogId: TabCatalogId; instanceKey?: string; label: string; href: string; kind?: 'page'; pinned?: boolean }[]
  activeId: string | null
}

/**
 * The state engine. Called ONCE by HubShell. Uses refs mirrored from state so
 * event handlers read the latest tabs/active-id without stale closures and
 * without nesting setState calls inside updaters.
 *
 * `storageKey` (per user) is where the open tabs are remembered; null = don't.
 */
export function useWorkspaceTabsState(enabled: boolean, storageKey: string | null = null): WorkspaceTabsApi {
  const [rawTabs, setTabsState] = useState<WorkspaceTab[]>([])
  const [rawActiveTabId, setActiveState] = useState<string | null>(null)
  const [rawRouteTabId, setRouteState] = useState<string | null>(null)
  const [rawSplitTabId, setSplitState] = useState<string | null>(null)
  const [evictionNotice, setEvictionNotice] = useState<string | null>(null)

  const tabsRef = useRef<WorkspaceTab[]>([])
  const activeIdRef = useRef<string | null>(null)
  const routeIdRef = useRef<string | null>(null)
  const splitIdRef = useRef<string | null>(null)
  const seqRef = useRef(0)
  const pageIdRef = useRef(0)

  // Every write goes through these so the refs are current immediately (the
  // shell's navigation effect reads them in the same commit).
  const setTabs = useCallback((next: WorkspaceTab[]) => { tabsRef.current = next; setTabsState(next) }, [])
  const setActive = useCallback((id: string | null) => { activeIdRef.current = id; setActiveState(id) }, [])
  const setRoute = useCallback((id: string | null) => { routeIdRef.current = id; setRouteState(id) }, [])
  const setSplitId = useCallback((id: string | null) => { splitIdRef.current = id; setSplitState(id) }, [])

  // Switching the feature OFF mid-session must CLOSE what's already open, not
  // merely block new tabs. Gating the exposed values (rather than clearing state
  // in an effect) means one render puts the Hub in exactly the state mobile is
  // always in: no strip, no kept-alive stack, the plain route on screen.
  const tabs = enabled ? rawTabs : EMPTY_TABS
  const activeTabId = enabled ? rawActiveTabId : null
  const routeTabId = enabled ? rawRouteTabId : null
  const splitTabId = enabled ? rawSplitTabId : null

  // ── Remember / restore ──────────────────────────────────────────────────────
  // Restore runs once, the first time the feature is on. Restored tabs come back
  // asleep (`restored`) — nothing reloads until it's clicked. After a REFRESH the
  // tab you were on comes back in front; arriving at a URL any other way (a link,
  // a notification, typing it) puts that URL's tab in front instead — the shell
  // handles that part.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!enabled || restoredRef.current) return
    restoredRef.current = true
    if (!storageKey) return
    let stored: StoredTabs | null = null
    try {
      const raw = localStorage.getItem(storageKey)
      stored = raw ? (JSON.parse(raw) as StoredTabs) : null
    } catch { stored = null }
    if (!stored || stored.v !== 1 || !Array.isArray(stored.tabs) || stored.tabs.length === 0) return
    let isReload = false
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      isReload = nav?.type === 'reload'
    } catch { /* ignore */ }
    const restored: WorkspaceTab[] = stored.tabs
      .filter(t => t && typeof t.id === 'string' && typeof t.href === 'string' && t.href.startsWith('/hub'))
      .slice(0, MAX_OPEN_TABS)
      .map(t => ({ ...t, lastActiveSeq: 0, restored: true }))
    for (const t of restored) {
      const m = /^p(\d+)$/.exec(t.id)
      if (m) pageIdRef.current = Math.max(pageIdRef.current, Number(m[1]))
    }
    // Merge with anything opened before this ran (same commit as the first route).
    const existing = tabsRef.current
    const merged = [...restored.filter(r => !existing.some(e => e.id === r.id || sameHref(e.href, r.href))), ...existing]
    setTabs(merged)
    if (isReload && stored.activeId && merged.some(t => t.id === stored!.activeId)) {
      const seq = ++seqRef.current
      setTabs(merged.map(t => (t.id === stored!.activeId ? { ...t, lastActiveSeq: seq, restored: false } : t)))
      setActive(stored.activeId)
    }
  }, [enabled, storageKey, setTabs, setActive])

  useEffect(() => {
    if (!enabled || !storageKey || !restoredRef.current) return
    const t = setTimeout(() => {
      const data: StoredTabs = {
        v: 1,
        tabs: rawTabs.map(({ id, catalogId, instanceKey, label, href, kind, pinned }) => ({ id, catalogId, instanceKey, label, href, kind, pinned })),
        activeId: rawActiveTabId,
      }
      try { localStorage.setItem(storageKey, JSON.stringify(data)) } catch { /* ignore */ }
    }, 300)
    return () => clearTimeout(t)
  }, [enabled, storageKey, rawTabs, rawActiveTabId])

  // ── Core ops ────────────────────────────────────────────────────────────────

  const activateTab = useCallback((id: string) => {
    const prev = tabsRef.current
    if (!prev.some(t => t.id === id)) return
    const seq = ++seqRef.current
    setTabs(prev.map(t => (t.id === id ? { ...t, lastActiveSeq: seq, restored: false } : t)))
    // Clicking the tab that's showing beside the active one swaps them.
    if (splitIdRef.current === id) setSplitId(activeIdRef.current)
    setActive(id)
  }, [setTabs, setActive, setSplitId])

  const findByHref = useCallback((href: string): WorkspaceTab | null => {
    return tabsRef.current.find(t => sameHref(t.href, href)) ?? null
  }, [])

  const activateByHref = useCallback((href: string): boolean => {
    if (!enabled) return false
    const match = findByHref(href)
    if (!match) return false
    activateTab(match.id)
    return true
  }, [enabled, findByHref, activateTab])

  const openTab = useCallback((input: OpenTabInput): string | null => {
    if (!enabled) return null
    const prev = tabsRef.current
    const baseId = input.kind === 'page' ? null : tabIdFor(input.catalogId, input.instanceKey)
    const activate = input.activate !== false
    const newCopy = !!input.newCopy && !CONVERSATION_TABS.has(input.catalogId)

    // Clicking something that's already open jumps to it — by id for twins, by
    // href for anything — unless Alt-click forced a new copy.
    if (!newCopy) {
      const existing = (baseId ? prev.find(t => t.id === baseId) : null) ?? prev.find(t => sameHref(t.href, input.href))
      if (existing) {
        if (activate) activateTab(existing.id)
        return existing.id
      }
    }

    let id: string
    if (baseId) {
      id = baseId
      if (prev.some(t => t.id === id)) {
        let n = 2
        while (prev.some(t => t.id === `${baseId}~${n}`)) n++
        id = `${baseId}~${n}`
      }
    } else {
      do { id = `p${++pageIdRef.current}` } while (prev.some(t => t.id === id))
    }

    const seq = activate ? ++seqRef.current : 0
    const newTab: WorkspaceTab = {
      id,
      catalogId: input.catalogId,
      instanceKey: input.instanceKey,
      label: input.label,
      href: input.href,
      lastActiveSeq: seq,
      kind: input.kind,
      restored: activate ? false : true,
    }
    let next = [...prev, newTab]

    // Safety cap → close the least-recently-used unpinned tab (never the new one,
    // never the one bound to the route).
    if (next.length > MAX_OPEN_TABS) {
      const candidates = next.filter(t => t.id !== id && !t.pinned && t.id !== routeIdRef.current && t.id !== activeIdRef.current)
      if (candidates.length) {
        const lru = candidates.reduce((a, b) => (b.lastActiveSeq < a.lastActiveSeq ? b : a))
        next = next.filter(t => t.id !== lru.id)
        if (splitIdRef.current === lru.id) setSplitId(null)
        setEvictionNotice(`Closed ${lru.label} — you have ${MAX_OPEN_TABS} tabs open.`)
      }
    }

    setTabs(next)
    if (activate) setActive(id)
    return id
  }, [enabled, activateTab, setTabs, setActive, setSplitId])

  const openApp = useCallback((input: OpenTabInput): string | null => {
    if (!enabled) return null
    if (!input.newCopy) {
      // 'page' is a catch-all kind, so for it "the same app" means the same path app.
      const mine = tabsRef.current.filter(t => input.catalogId === 'page'
        ? t.catalogId === 'page' && appKeyFromPath(t.href) === appKeyFromPath(input.href)
        : t.catalogId === input.catalogId && (input.instanceKey === undefined || t.instanceKey === input.instanceKey))
      if (mine.length) {
        const recent = mine.reduce((a, b) => (b.lastActiveSeq > a.lastActiveSeq ? b : a))
        activateTab(recent.id)
        return recent.id
      }
    }
    return openTab(input)
  }, [enabled, activateTab, openTab])

  const closeTab = useCallback((id: string) => {
    const prev = tabsRef.current
    const idx = prev.findIndex(t => t.id === id)
    if (idx === -1) return
    const next = prev.filter(t => t.id !== id)
    if (routeIdRef.current === id) setRoute(null)
    if (splitIdRef.current === id) setSplitId(null)

    if (activeIdRef.current === id) {
      // The split partner takes over the window; otherwise the most recently
      // used tab (not just whichever is next to it, which may be asleep).
      let newActiveId: string | null = null
      if (splitIdRef.current && splitIdRef.current !== id) {
        newActiveId = splitIdRef.current
        setSplitId(null)
      } else if (next.length) {
        newActiveId = next.reduce((a, b) => (b.lastActiveSeq > a.lastActiveSeq ? b : a)).id
      }
      if (newActiveId) {
        const seq = ++seqRef.current
        setTabs(next.map(t => (t.id === newActiveId ? { ...t, lastActiveSeq: seq, restored: false } : t)))
      } else {
        setTabs(next)
      }
      setActive(newActiveId)
      return
    }
    setTabs(next)
  }, [setTabs, setActive, setRoute, setSplitId])

  const closeOthers = useCallback((id: string) => {
    const keep = tabsRef.current.filter(t => t.id === id || t.pinned)
    if (routeIdRef.current && !keep.some(t => t.id === routeIdRef.current)) setRoute(null)
    setSplitId(null)
    setTabs(keep)
    activateTab(id)
  }, [setTabs, setRoute, setSplitId, activateTab])

  const duplicateTab = useCallback((id: string) => {
    const t = tabsRef.current.find(x => x.id === id)
    if (!t) return
    openTab({ catalogId: t.catalogId, label: t.label, href: t.href, instanceKey: t.instanceKey, kind: t.kind, newCopy: true })
  }, [openTab])

  const setPinned = useCallback((id: string, pinned: boolean) => {
    setTabs(tabsRef.current.map(t => (t.id === id ? { ...t, pinned } : t)))
  }, [setTabs])

  const updateTab = useCallback((id: string, patch: { href?: string; label?: string }) => {
    const prev = tabsRef.current
    const t = prev.find(x => x.id === id)
    if (!t) return
    const href = patch.href ?? t.href
    const label = patch.label ?? t.label
    if (href === t.href && label === t.label) return
    setTabs(prev.map(x => (x.id === id ? { ...x, href, label } : x)))
  }, [setTabs])

  const bindRoute = useCallback((id: string | null) => { setRoute(id) }, [setRoute])

  const setSplit = useCallback((id: string | null) => {
    if (id && id === activeIdRef.current) {
      // Split the active tab off: it goes beside, the most recent other tab comes in front.
      const others = tabsRef.current.filter(t => t.id !== id)
      if (!others.length) return
      const recent = others.reduce((a, b) => (b.lastActiveSeq > a.lastActiveSeq ? b : a))
      setSplitId(id)
      activateTab(recent.id)
      setSplitId(id)
      return
    }
    if (id) {
      const seq = ++seqRef.current
      setTabs(tabsRef.current.map(t => (t.id === id ? { ...t, lastActiveSeq: seq, restored: false } : t)))
    }
    setSplitId(id)
  }, [setSplitId, activateTab, setTabs])

  const showRoute = useCallback(() => {
    if (routeIdRef.current) activateTab(routeIdRef.current)
  }, [activateTab])

  const isOpen = useCallback(
    (catalogId: TabCatalogId, instanceKey?: string) => enabled && tabsRef.current.some(t => t.id === tabIdFor(catalogId, instanceKey)),
    [enabled],
  )

  const clearEvictionNotice = useCallback(() => setEvictionNotice(null), [])

  const peek = useCallback(() => (enabled
    ? { tabs: tabsRef.current, activeTabId: activeIdRef.current, routeTabId: routeIdRef.current, splitTabId: splitIdRef.current }
    : { tabs: EMPTY_TABS, activeTabId: null, routeTabId: null, splitTabId: null }), [enabled])

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  )

  // Awake = the MAX_AWAKE_TABS most recently used tabs that have been opened this
  // visit, plus whatever is on screen. Everything else sleeps (unmounted).
  const awakeIds = useMemo<ReadonlySet<string>>(() => {
    if (!tabs.length) return EMPTY_SET
    const set = new Set<string>()
    tabs
      .filter(t => !t.restored)
      .slice()
      .sort((a, b) => b.lastActiveSeq - a.lastActiveSeq)
      .slice(0, MAX_AWAKE_TABS)
      .forEach(t => set.add(t.id))
    if (activeTabId) set.add(activeTabId)
    if (splitTabId) set.add(splitTabId)
    return set
  }, [tabs, activeTabId, splitTabId])

  return useMemo<WorkspaceTabsApi>(() => ({
    enabled,
    tabs,
    activeTabId,
    activeTab,
    routeTabId,
    splitTabId,
    awakeIds,
    openTab,
    openApp,
    activateTab,
    activateByHref,
    findByHref,
    closeTab,
    closeOthers,
    duplicateTab,
    setPinned,
    updateTab,
    bindRoute,
    setSplit,
    showRoute,
    isOpen,
    evictionNotice,
    clearEvictionNotice,
    peek,
  }), [enabled, tabs, activeTabId, activeTab, routeTabId, splitTabId, awakeIds, openTab, openApp, activateTab, activateByHref, findByHref, closeTab, closeOthers, duplicateTab, setPinned, updateTab, bindRoute, setSplit, showRoute, isOpen, evictionNotice, clearEvictionNotice, peek])
}

// ── Context distribution ────────────────────────────────────────────────────

export const DISABLED_TABS_API: WorkspaceTabsApi = {
  enabled: false,
  tabs: [],
  activeTabId: null,
  activeTab: null,
  routeTabId: null,
  splitTabId: null,
  awakeIds: EMPTY_SET,
  openTab: () => null,
  openApp: () => null,
  activateTab: () => {},
  activateByHref: () => false,
  findByHref: () => null,
  closeTab: () => {},
  closeOthers: () => {},
  duplicateTab: () => {},
  setPinned: () => {},
  updateTab: () => {},
  bindRoute: () => {},
  setSplit: () => {},
  showRoute: () => {},
  isOpen: () => false,
  evictionNotice: null,
  clearEvictionNotice: () => {},
  peek: () => ({ tabs: [], activeTabId: null, routeTabId: null, splitTabId: null }),
}

const WorkspaceTabsCtx = createContext<WorkspaceTabsApi | null>(null)

export function WorkspaceTabsProvider({ api, children }: { api: WorkspaceTabsApi; children: ReactNode }) {
  return <WorkspaceTabsCtx.Provider value={api}>{children}</WorkspaceTabsCtx.Provider>
}

/** Read the tab api. Returns an inert disabled api if used outside a provider (e.g. mobile). */
export function useWorkspaceTabs(): WorkspaceTabsApi {
  return useContext(WorkspaceTabsCtx) ?? DISABLED_TABS_API
}

/**
 * The path that's actually on screen. With tabs the window's URL stays on the
 * route it last navigated to while you work in other tabs, so "am I on the
 * Dialer?"-style checks must ask the active tab, not the URL.
 */
export function useOnScreenPath(): string {
  const pathname = usePathname() ?? ''
  const { activeTab } = useWorkspaceTabs()
  return activeTab ? activeTab.href.split('?')[0] : pathname
}

/** The order the strip shows tabs in (pinned first) — also what Ctrl/⌘+N counts. */
export function tabsInStripOrder(tabs: WorkspaceTab[]): WorkspaceTab[] {
  return [...tabs.filter(t => t.pinned), ...tabs.filter(t => !t.pinned)]
}
