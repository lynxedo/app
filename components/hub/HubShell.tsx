'use client'

import type { WorkOrderViewPerms } from '@/lib/work-order-access'
import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import HubSidebar from './HubSidebar'
import { useHubMessageInsert } from './HubMessagesProvider'
import HubRail, { railFromPath, type RailId } from './HubRail'
import HubMobileBar from './HubMobileBar'
import HubMobileMore from './HubMobileMore'
import HubMenuPanel from './HubMenuPanel'
import HubTopBar from './HubTopBar'
import PhonePopover from './dialer/PhonePopover'
import LayoutEditor from './LayoutEditor'
import HubActivityPanel from './HubActivityBell'
import { THEME_IDS } from '@/lib/themes'
import ProfileSidebar from './sidebars/ProfileSidebar'
import HubSectionSidebar, { SECTION_SIDEBAR_RAILS, resolveAdminGrants, type RawAdminGrants } from './HubSectionSidebar'
import EmbeddedHubShell from './EmbeddedHubShell'
import AnnouncementTicker, { type Announcement } from './AnnouncementTicker'
import HubQuickCompose, { type SearchAnchor } from './HubQuickCompose'
import TimesheetClockModal from './TimesheetClockModal'
import NotifPrefsModal from './NotifPrefsModal'
import DialerProvider from './dialer/DialerProvider'
import GlobalCallBar from './dialer/GlobalCallBar'
import RadioBar from './radio/RadioBar'
import ConversationPopoutProvider from './popout/ConversationPopoutProvider'
import { BetaFlagsProvider } from './BetaFlagsContext'
import OnCallPresenceProvider from './OnCallPresenceProvider'
import HubActivityPinger from './HubActivityPinger'
import { WorkspaceTabsProvider, useWorkspaceTabsState, tabsInStripOrder, CONVERSATION_TABS, type WorkspaceTab, type TabCatalogId, type OpenTabInput } from './workspace/WorkspaceTabsContext'
import WorkspaceTabStrip, { TAB_DRAG_EVENT, TAB_DRAG_MIME } from './workspace/WorkspaceTabStrip'
import WorkspaceTabErrorBoundary from './workspace/WorkspaceTabErrorBoundary'
import { WorkspaceTabInstanceProvider } from './workspace/WorkspaceTabInstance'
import PageTabFrame, { type PageTabFrameHandlers } from './workspace/PageTabFrame'
import { resolveTabHref, pageTabMeta, sameApp, type ResolveContext } from './workspace/resolveTabHref'
import { subscribeSharedBroadcast } from '@/lib/realtime-shared-channel'
import { isDesktopEnvironment } from '@/lib/is-desktop'
import { isWindowOnlyPath, appKeyFromPath, isEmbeddedTabFrame } from '@/lib/hub-embed'
import { requestDial, registerDialHandler } from '@/lib/hub-dial'
import { requestHubIntent, type HubIntentKind } from '@/lib/hub-intent'
import dynamic from 'next/dynamic'
import { useHubVoicemailCount } from '@/hooks/use-hub-voicemail-count'
import { useHubMissedCall } from '@/hooks/use-hub-missed-call'
import { createClient } from '@/lib/supabase/client'
import type { HubUser } from './MessageFeed'
import { type RailPermissions } from './railCatalog'
import { type HubLayout } from '@/lib/hub-layout'
import { persistStorage } from '@/lib/hub-cache'

type Room = { id: string; name: string; is_private: boolean }
type RailConversation = { id: string; participants: { id: string; display_name: string; avatar_url?: string | null }[] }

export const HUB_CONV_CREATED_EVENT = 'hub-conversation-created'

// Sections that have a sidebar of their own. Driven by a manual override
// (rail click) for sections that have no URL (profile).
type ManualRail = 'profile' | 'activity' | null

// Tab twins are lazy-loaded (next/dynamic) so the Hub shell bundle doesn't
// eagerly include every tab-able screen's code — each chunk loads only when a
// tab of that kind is first opened. Kept-alive behavior is unaffected: once
// loaded the component stays mounted (display-toggled), never re-fetched.
const TabLoading = () => <div className="flex-1 min-h-0 p-6 text-sm text-white/40">Loading…</div>
const ContactsPanel = dynamic(() => import('@/app/hub/contacts/ContactsPanel'), { ssr: false, loading: TabLoading })
const PricerView = dynamic(() => import('@/app/hub/pricer/PricerView'), { ssr: false, loading: TabLoading })
const ScoreboardsIndexTab = dynamic(() => import('./workspace/ScoreboardsTab').then(m => m.ScoreboardsIndexTab), { ssr: false, loading: TabLoading })
const ScoreboardBoardTab = dynamic(() => import('./workspace/ScoreboardsTab').then(m => m.ScoreboardBoardTab), { ssr: false, loading: TabLoading })
const TrackerLeadsTab = dynamic(() => import('./workspace/TrackerLeadsTab'), { ssr: false, loading: TabLoading })
const RoutingTab = dynamic(() => import('./workspace/RoutingTab'), { ssr: false, loading: TabLoading })
const BoardTab = dynamic(() => import('./workspace/BoardTab'), { ssr: false, loading: TabLoading })
const ChatTab = dynamic(() => import('./workspace/ChatTab'), { ssr: false, loading: TabLoading })
const TxtTab = dynamic(() => import('./workspace/TxtTab'), { ssr: false, loading: TabLoading })
const DailyLogV2View = dynamic(() => import('@/components/hub/DailyLogV2View'), { ssr: false, loading: TabLoading })
const EmailThreadView = dynamic(() => import('@/components/hub/email/EmailThreadView'), { ssr: false, loading: TabLoading })

export type HubShellProps = {
  rooms: Room[]
  userEmail: string
  currentUserId: string
  hubUsers: HubUser[]
  currentUserStatus?: string | null
  currentUserDisplayName?: string
  currentUserAvatarUrl?: string | null
  isAdmin?: boolean
  isPlatformAdmin?: boolean
  billingEnabled?: boolean
  adminGrants?: RawAdminGrants
  initialActiveAnnouncements?: Announcement[]
  initialTextSize?: string
  initialTheme?: string
  initialPinnedIds?: string[]
  /** Per-user Workspace Tabs switch (Hub Settings → My Hub). Defaults to today's behaviour: on. */
  initialTabsEnabled?: boolean
  initialIsClockedIn?: boolean
  initialLayout?: HubLayout | null
  canAccessTracker?: boolean
  canAccessCallLog?: boolean
  canAccessCallLog2?: boolean
  canAccessLawn?: boolean
  canAccessTimesheet?: boolean
  canAccessRouting?: boolean
  canAccessFleet?: boolean
  canAccessDialer?: boolean
  canAccessTxt?: boolean
  canManageTxt?: boolean
  canAccessUnifiedInbox?: boolean
  canAccessMarketing?: boolean
  canAdminMarketing?: boolean
  canAccessEmail?: boolean
  canAccessSharedInbox?: boolean
  canComposeSharedEmail?: boolean
  canManageDrip?: boolean
  canAdminEmail?: boolean
  canAccessForms?: boolean
  canAccessDailyLogV2?: boolean
  canAccessScoreboards?: boolean
  /**
   * ⚠ REQUIRED, unlike its neighbours, and deliberately so.
   *
   * This prop was optional and the layout never passed it, so `!!undefined` made
   * it false for everyone and the Reports icon was filtered out of the rail and
   * the app drawer — for admins too — even with the flag granted, the page live
   * and `'reports'` already saved in the user's layout. Nothing failed; the icon
   * simply wasn't there, which is indistinguishable from "not shipped".
   *
   * An optional boolean permission prop cannot be forgotten loudly: the default
   * is the locked state. Making this one required means the compiler catches the
   * omission. The rest of these should follow (ideally by passing the
   * RailPermissions object the layout already builds), but that is a wider change
   * than the bug in front of it.
   */
  canAccessReports: boolean
  canAccessFiles?: boolean
  canAccessPesticideRecords?: boolean
  canAccessPricer?: boolean
  canAccessQuotes?: boolean
  /** The Work Orders tab's buttons — same helper as the page (lib/work-order-access.ts). */
  workOrderPerms?: WorkOrderViewPerms
  canAccessHub?: boolean
  scoreboardSlugs?: string[]
  /** Reports this user may open. REQUIRED so a missing wire-up fails the
   *  type-check rather than silently listing reports that bounce on click. */
  reportSlugs: string[]
  companyId?: string
  /** Session 58.5: when true (default) AND canAccessDialer, the Twilio
   *  Device registers on every Hub page so IncomingCall pops anywhere. */
  dialerGlobalRing?: boolean
  myPresenceMode?: 'clock' | 'activity'
  initialMasterDndEnabled?: boolean
  initialHubDndEnabled?: boolean
  initialDialerDndEnabled?: boolean
  /** Resolved beta flag map (featureKey → on) for this user; see lib/beta-flags.ts. */
  betaFlags?: Record<string, boolean>
  /** Whether the Beta Features settings section is available (admins + the
   *  can_access_beta grant) — gates the Settings sidebar's Beta row. */
  canAccessBeta?: boolean
  children: React.ReactNode
  /**
   * This page is running INSIDE a Workspace Tab (a page tab's frame), decided by
   * the layout from the request (Sec-Fetch-Dest: iframe). Sticky for the life of
   * the frame — the embedded shell renders instead of the full one.
   */
  embedded?: boolean
}

/**
 * The Hub shell. In the Hub window this is the full shell (rail, top bar, tabs,
 * phone…); inside a Workspace Tab's frame it's the embedded shell. Decided once —
 * a later server re-render (router.refresh inside the frame) can't flip it.
 */
export default function HubShell(props: HubShellProps) {
  const [embedded] = useState(() => !!props.embedded || isEmbeddedTabFrame())
  return embedded ? <EmbeddedHubShell {...props} /> : <FullHubShell {...props} />
}

function FullHubShell({
  rooms,
  userEmail,
  currentUserId,
  hubUsers,
  currentUserStatus,
  currentUserDisplayName,
  currentUserAvatarUrl,
  isAdmin,
  isPlatformAdmin,
  billingEnabled,
  adminGrants,
  initialActiveAnnouncements,
  initialTextSize,
  initialTheme,
  initialPinnedIds,
  initialTabsEnabled = true,
  initialIsClockedIn,
  initialLayout,
  canAccessTracker,
  canAccessCallLog,
  canAccessCallLog2,
  canAccessLawn,
  canAccessTimesheet,
  canAccessRouting,
  canAccessFleet,
  canAccessDialer,
  canAccessTxt,
  canManageTxt,
  canAccessUnifiedInbox,
  canAccessMarketing,
  canAdminMarketing,
  canAccessEmail,
  canAccessSharedInbox,
  canComposeSharedEmail,
  canManageDrip,
  canAdminEmail,
  canAccessForms,
  canAccessDailyLogV2,
  canAccessScoreboards,
  canAccessReports,
  canAccessFiles,
  canAccessPesticideRecords,
  canAccessPricer,
  canAccessQuotes,
  workOrderPerms,
  canAccessHub,
  scoreboardSlugs,
  reportSlugs,
  companyId,
  dialerGlobalRing,
  myPresenceMode,
  initialMasterDndEnabled = false,
  initialHubDndEnabled = false,
  initialDialerDndEnabled = false,
  betaFlags = {},
  canAccessBeta = false,
  children,
}: HubShellProps) {
  const pathname = usePathname() ?? ''
  const pathRail = railFromPath(pathname)
  // Held in a ref so the Daily Log broadcast effect can read the live path
  // without re-subscribing its Supabase channel on every navigation.
  // (With tabs it holds the path ON SCREEN — see viewHref below.)
  const pathnameRef = useRef(pathname)

  const [manualRail, setManualRail] = useState<ManualRail>(null)
  useEffect(() => { setManualRail(null) }, [pathname])

  // ── Workspace Tabs (desktop, unless the user switched them off) ─────────────
  // Graduated out of beta Aug 13 2026 — on for every desktop user by default.
  // Desktop-only is a DESIGN decision, not a rollout gate: the field/mobile Hub
  // keeps its rail + drawer, so `isDesktopEnvironment()` stays. The per-user
  // preference is ANDed with it, never OR'd — ticking the box on a phone must
  // not hand it a tab strip.
  // Resolved on the client (navigator UA) via an effect so SSR + first paint
  // agree (feature off) and nothing hydration-mismatches; the strip only renders
  // once a tab is opened, so the Hub is byte-identical until then.
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => { setIsDesktop(isDesktopEnvironment()) }, [])
  // Mirrors the server value but lives in state so the strip can appear/disappear
  // the instant the setting is clicked, with no reload.
  const [tabsPref, setTabsPref] = useState(initialTabsEnabled)
  useEffect(() => { setTabsPref(initialTabsEnabled) }, [initialTabsEnabled])
  // /hub/settings renders as `children` INSIDE this shell, so the Settings toggle
  // can't hand the new value up through props — it dispatches this window event
  // instead, and the shell re-reads the server value on the next load.
  useEffect(() => {
    function onPref(e: Event) {
      const next = (e as CustomEvent<boolean>).detail
      if (typeof next === 'boolean') setTabsPref(next)
    }
    window.addEventListener('hub-tabs-pref-changed', onPref)
    return () => window.removeEventListener('hub-tabs-pref-changed', onPref)
  }, [])
  const tabsFeature = isDesktop && tabsPref
  const tabsApi = useWorkspaceTabsState(tabsFeature, currentUserId ? `hub-workspace-tabs:v1:${currentUserId}` : null)
  // Latest api + resolver inputs for event handlers / effects that must not
  // re-subscribe on every render. The resolver context is filled in further down,
  // once permissions/rooms/conversations are known (effects run after render).
  const tabsApiRef = useRef(tabsApi)
  tabsApiRef.current = tabsApi
  const resolveCtxRef = useRef<ResolveContext | null>(null)
  const router = useRouter()

  // ── Everything opens in a tab ─────────────────────────────────────────────
  // A REAL navigation of the window (the first load, a Link in the window, a
  // router.push from a screen) lands in a tab:
  //   - already open (same href) → that tab comes to the front; if it's a page
  //     tab it becomes the one bound to the route, so the page isn't mounted twice;
  //   - inside the route tab's own app (Admin → People) → the route tab follows;
  //   - otherwise → a new tab bound to the route. The page the window already
  //     fetched IS its content, so nothing loads twice. The tab that held the route
  //     before becomes a frame (or a twin, if it has one) next time it's shown.
  // On the first load after a refresh, the tab you were on stays in front (the
  // restore put it there); the URL's tab is bound but not brought forward.
  const routeInitRef = useRef(false)
  const [routeReady, setRouteReady] = useState(false)
  useEffect(() => {
    if (!tabsFeature) return
    const api = tabsApiRef.current
    const ctx = resolveCtxRef.current
    if (!ctx) return
    const href = pathname + window.location.search
    const first = !routeInitRef.current
    routeInitRef.current = true
    setRouteReady(true)
    const live = api.peek()
    const keepFront = first && !!live.activeTabId

    const r = resolveTabHref(href, ctx)
    const twin = r && r.action === 'tab' && r.input.kind !== 'page' ? r.input : null

    // A screen with a twin (a room, a DM, a thread, Contacts…) is one tab,
    // whatever its URL says: its tab is keyed by the canonical href, and if that
    // tab is a TWIN the route is released (children unmounted), so the same
    // conversation is never mounted twice — two subscribers on its feed topic is
    // the collision that white-screened DMs.
    const existing = twin
      ? (api.findByHref(twin.href) ?? live.tabs.find(t => t.catalogId === twin.catalogId && (t.instanceKey ?? null) === (twin.instanceKey ?? null)) ?? null)
      : api.findByHref(href)
    if (existing) {
      api.bindRoute(existing.kind === 'page' ? existing.id : null)
      if (!keepFront) api.activateTab(existing.id)
      return
    }
    const routeTab = live.routeTabId ? live.tabs.find(t => t.id === live.routeTabId) : null
    if (!first && !twin && routeTab && live.activeTabId === routeTab.id && sameApp(routeTab.href, href)) {
      api.updateTab(routeTab.id, { href })
      return
    }
    const meta = pageTabMeta(href)
    const input: OpenTabInput = twin
      ? { ...twin, kind: 'page' }
      : r && r.action === 'tab'
        ? { ...r.input, href, kind: 'page' }
        : { catalogId: href.startsWith('/hub/dialer') ? 'dialer' : 'page', label: href.startsWith('/hub/dialer') ? 'Dialer' : meta.label, href, kind: 'page' }
    const id = api.openTab({ ...input, activate: !keepFront })
    if (id) api.bindRoute(id)
  }, [pathname, tabsFeature])

  // Open an href as a tab WITHOUT navigating the window (menu, rail, links in a
  // tab, things handed up from a page tab). Window-only screens (Dialer, Radio)
  // navigate the window instead — the effect above then binds them.
  const openHref = useCallback((href: string, opts?: { newCopy?: boolean }) => {
    const ctx = resolveCtxRef.current
    const api = tabsApiRef.current
    if (!api.enabled || !ctx) { router.push(href); return }
    // Help lives outside the Hub's pages but still opens as a tab.
    if (href === '/help') { api.openApp({ catalogId: 'help', label: 'Help', href, kind: 'page' }); return }
    const existing = !opts?.newCopy ? api.findByHref(href) : null
    if (existing) { api.activateTab(existing.id); return }
    const r = resolveTabHref(href, ctx)
    if (!r) { router.push(href); return }
    if (r.action === 'window') { router.push(href); return }
    // A conversation is never open twice (two tabs = two subscribers on its feed).
    const newCopy = !!opts?.newCopy && !CONVERSATION_TABS.has(r.input.catalogId)
    api.openTab({ ...r.input, newCopy })
  }, [router])

  // Never an empty window: closing the last tab brings back the Hub chat.
  const tabCount = tabsApi.tabs.length
  useEffect(() => {
    if (tabsFeature && routeReady && tabCount === 0) openHref('/hub')
  }, [tabsFeature, routeReady, tabCount, openHref])

  // A Link clicked in the window: open it as a tab instead of navigating — the
  // one exception is a link inside the route tab's own app, which is an ordinary
  // in-tab move. Capture phase so the Link's own navigation is skipped (Next's
  // <Link> bails when the click is already defaultPrevented). Rail and menu items
  // carry data-lx-nav and open apps themselves.
  useEffect(() => {
    if (!tabsFeature) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      if (a.closest('[data-lx-nav]')) return
      let url: URL
      try { url = new URL(a.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/hub')) return
      const href = url.pathname + url.search
      const live = tabsApiRef.current.peek()
      const active = live.tabs.find(t => t.id === live.activeTabId)
      if (active && active.id === live.routeTabId && sameApp(active.href, href)) return
      const ctx = resolveCtxRef.current
      const r = ctx ? resolveTabHref(href, ctx) : null
      if (!r || r.action === 'window') return
      e.preventDefault()
      openHref(href, { newCopy: e.altKey })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [tabsFeature, openHref])

  // A page tab bound to a window-only screen (the Dialer) that lost the route to
  // another tab can't be framed — bring the window back to it when it's shown.
  useEffect(() => {
    const t = tabsApi.activeTab
    if (!t || t.kind !== 'page' || t.id === tabsApi.routeTabId) return
    if (isWindowOnlyPath(t.href)) router.push(t.href)
  }, [tabsApi.activeTab, tabsApi.routeTabId, router])

  // What's on screen: the active tab when there is one, the URL otherwise (which
  // is exactly the pre-tabs behaviour). With tabs the URL stays on whatever route
  // the window last navigated to, so on-screen checks must use this.
  const viewHref = tabsApi.activeTab ? tabsApi.activeTab.href.split('?')[0] : pathname
  pathnameRef.current = viewHref
  // Switching tabs closes the "You" panel the same way navigating does.
  const activeTabIdForRail = tabsApi.activeTabId
  useEffect(() => { setManualRail(null) }, [activeTabIdForRail])

  // Is the user in Txt right now? Without this the rail dot lit for the very
  // thread on screen, and the "I've seen Txt" stamp never fired for tabs.
  const onTxtSurface = viewHref === '/hub/txt' || viewHref.startsWith('/hub/txt/')
  const onTxtSurfaceRef = useRef(onTxtSurface)
  onTxtSurfaceRef.current = onTxtSurface

  // Shared Inbox surface. `/hub/marketing/email` is Email Marketing, a different
  // app, and startsWith('/hub/email') correctly does not match it.
  const onInboxSurface = viewHref === '/hub/email' || viewHref.startsWith('/hub/email/')
  const onInboxSurfaceRef = useRef(onInboxSurface)
  onInboxSurfaceRef.current = onInboxSurface

  // Deep link from Settings → My Hub: /hub?customize=1 opens the layout editor.
  // Read on the client to avoid a Suspense requirement from useSearchParams.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('customize') === '1') {
        setShowLayoutEditor(true)
      }
    } catch { /* ignore */ }
  }, [])

  // Ask the platform for durable IndexedDB storage so the Hub cache survives
  // memory pressure on iOS WKWebView and other constrained environments.
  // Idempotent; no UI prompt; safe to ignore the result.
  useEffect(() => { void persistStorage() }, [])

  // A kept-alive tab, when active, drives the sidebar + rail highlight via its
  // catalogId (a subset of RailId); board tabs map to the Hub rail (they have no
  // rail entry, same as the real /hub/board route → railFromPath = 'hub').
  // Page tabs answer by their path (a Reports page tab lights Reports).
  const catalogToRail = (c: TabCatalogId, href?: string): RailId =>
    c === 'txt-thread' ? 'txt2'
    : c === 'inbox-thread' ? 'email-inbox'
    : (c === 'board' || c === 'room' || c === 'dm') ? 'hub'
    : c === 'page' ? railFromPath(href)
    : c
  const tabRail = (t: WorkspaceTab): RailId => catalogToRail(t.catalogId, t.href)
  const activeRail: RailId = tabsApi.activeTab ? tabRail(tabsApi.activeTab) : (manualRail ?? pathRail)

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [showMobileMore, setShowMobileMore] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)
  const EMPTY_LAYOUT: HubLayout = { version: 3, items: [] }
  const [liveLayout, setLiveLayout] = useState<HubLayout>(initialLayout ?? EMPTY_LAYOUT)
  // NAV-PermGrant: keep the launcher in sync when the SERVER layout changes (e.g. a new
  // app auto-seeded after a mid-session permission grant), without clobbering an in-flight
  // optimistic edit. layoutSavingRef is true while a save is in flight; lastSyncedLayoutRef
  // remembers the last server value so we only re-sync on a real change.
  const layoutSavingRef = useRef(false)
  const lastSyncedLayoutRef = useRef(initialLayout ? JSON.stringify(initialLayout) : '')
  // NOTE: We intentionally do NOT auto-refresh the server tree on tab focus /
  // visibility. A router.refresh() there yanked the page out from under people —
  // it wiped in-progress input (e.g. a half-typed new lead) and silently
  // swallowed the "Refresh to update" banner after a deploy (the refresh re-read
  // the new build id, so <UpdateNotifier> never had a mismatch to show). Updates
  // are now surfaced ONLY by <UpdateNotifier> (a user-initiated reload), and a
  // freshly-granted app icon surfaces on the user's next navigation instead.
  // Do not re-add a focus/visibility router.refresh() here.
  // ⚠ The ONE narrow exception lives in components/hub/HubWarmResume.tsx (Sep 17
  // 2026): a refresh after 30+ minutes backgrounded, in the native app only, and
  // never while hasUnsavedWork() is true. It exists because Radio's premise is a
  // channel staying warm in a pocket, so pulling the phone out to a frozen screen
  // is the one failure it cannot afford. It is gated precisely to avoid both
  // failures above — widen it and you will re-create them.
  // Lightweight conversation list so DM tokens on the rail/dock/drawer can show
  // a label + avatar. (The sidebar fetches its own richer copy.)
  const [railConversations, setRailConversations] = useState<RailConversation[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/conversations')
      .then(r => (r.ok ? r.json() : { conversations: [] }))
      .then(d => { if (!cancelled) setRailConversations((d.conversations ?? []) as RailConversation[]) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  // Desktop search drops down from the top bar's search box (Slack-style); with
  // no visible box (phones) it's the full-screen palette.
  const [searchAnchor, setSearchAnchor] = useState<SearchAnchor | null>(null)
  const openSearch = useCallback(() => {
    const r = document.getElementById('hub-topbar-search')?.getBoundingClientRect()
    if (r && r.width > 0) {
      const width = Math.min(Math.max(r.width, 640), window.innerWidth - 16)
      const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8))
      setSearchAnchor({ top: r.top, left, width })
    } else {
      setSearchAnchor(null)
    }
    setShowCompose(true)
  }, [])
  const showComposeRef = useRef(showCompose)
  showComposeRef.current = showCompose
  const toggleSearch = useCallback(() => {
    if (showComposeRef.current) setShowCompose(false)
    else openSearch()
  }, [openSearch])
  const [showTimeClock, setShowTimeClock] = useState(false)
  const [showNotifPrefs, setShowNotifPrefs] = useState(false)
  const [textSize, setTextSize] = useState(initialTextSize ?? 'default')
  const [theme, setTheme] = useState(initialTheme ?? 'midnight')
  const [liveStatus, setLiveStatus] = useState<string | null>(currentUserStatus ?? null)
  const [masterDndEnabled, setMasterDndEnabled] = useState<boolean>(initialMasterDndEnabled)
  const [hubDndEnabled, setHubDndEnabled] = useState<boolean>(initialHubDndEnabled)
  const [dialerDndEnabled, setDialerDndEnabled] = useState<boolean>(initialDialerDndEnabled)
  const [unreadActivity, setUnreadActivity] = useState<number>(0)
  const [unreadHub, setUnreadHub] = useState<boolean>(false)
  const [dailyLogUnread, setDailyLogUnread] = useState<boolean>(false)
  const [txtUnread, setTxtUnread] = useState<boolean>(false)
  const [inboxUnread, setInboxUnread] = useState<boolean>(false)
  const [missedCall, setMissedCall] = useState<boolean>(false)
  const [showActivity, setShowActivity] = useState(false)
  const [isClockedIn, setIsClockedIn] = useState<boolean>(!!initialIsClockedIn)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  // Viewport breakpoint detection — used to skip the mobile-bottom-bar
  // padding on desktop (no tab bar there).
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Sidebar collapsed state — persisted.
  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem('hub-sidebar-collapsed') === '1') } catch {}
  }, [])
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('hub-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }, [])
  // Force the sidebar open (no toggle). Used when rail icons navigate to a
  // different section — Ben's UX rule: clicking a nav icon should make the
  // sidebar visible regardless of its prior collapsed state.
  const openSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      if (!prev) return prev
      try { localStorage.setItem('hub-sidebar-collapsed', '0') } catch {}
      return false
    })
  }, [])

  // Remember last chat path for the rail's Hub icon to jump back to.
  useEffect(() => {
    if (pathRail === 'hub' && pathname.startsWith('/hub') && !pathname.startsWith('/hub/home')) {
      try { localStorage.setItem('hub_last_chat_route', pathname) } catch {}
    }
  }, [pathname, pathRail])

  // Root font-size scaling sync (SET-textsize).
  // app/layout.tsx (server) is the SOLE owner of the INITIAL text-size class —
  // it SSRs `text-size-${profile.hub_text_size}` onto <html>, so the first
  // paint is already correct and there's no flash. This effect must therefore
  // NOT re-write the class on mount (a redundant second writer); it only reacts
  // to LIVE changes when the user picks a new size in Settings.
  const didMountTextSize = useRef(false)
  useEffect(() => {
    if (!didMountTextSize.current) {
      didMountTextSize.current = true
      return
    }
    const html = document.documentElement
    html.classList.remove('text-size-small', 'text-size-default', 'text-size-large')
    html.classList.add(`text-size-${textSize}`)
  }, [textSize])

  // Theme class sync — same pattern as textSize above.
  // Server stamps the initial theme-* class; this effect only fires on live changes.
  const THEME_NAMES = THEME_IDS
  const didMountTheme = useRef(false)
  useEffect(() => {
    if (!didMountTheme.current) {
      didMountTheme.current = true
      return
    }
    const html = document.documentElement
    html.classList.remove(...THEME_NAMES.map(t => `theme-${t}`))
    html.classList.add(`theme-${theme}`)
  }, [theme]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror keyboardOpen onto the body so CSS can react. Headers tagged with
  // data-hide-on-keyboard collapse on mobile when the composer is focused.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (keyboardOpen) {
      document.body.setAttribute('data-keyboard-open', 'true')
    } else {
      document.body.removeAttribute('data-keyboard-open')
    }
    return () => { document.body.removeAttribute('data-keyboard-open') }
  }, [keyboardOpen])

  // Visual Viewport: track scroll offset for iOS fixed-bar following AND
  // detect keyboard-open (height shrink) so we can hide mobile chrome.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const initialHeight = window.innerHeight
    function update() {
      document.documentElement.style.setProperty('--vv-top', `${vv!.offsetTop}px`)
      // Keyboard open heuristic: visual viewport noticeably shorter than
      // window inner height. Threshold 150px filters out toolbar collapse
      // (Safari ~80px). 150px is a typical software keyboard floor.
      const shrunk = (initialHeight - vv!.height) > 150
      setKeyboardOpen(shrunk)
    }
    vv.addEventListener('scroll', update)
    vv.addEventListener('resize', update)
    update()
    return () => {
      vv.removeEventListener('scroll', update)
      vv.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--vv-top')
    }
  }, [])

  // Cmd+K / Ctrl+K opens Quick Compose.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleSearch()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Activity unread count. NAV-HubShellEffects: the 90s interval is created ONCE
  // (stable deps) instead of being torn down + recreated on every navigation; a
  // separate cheap effect still refreshes immediately when the route changes.
  const refreshActivity = useCallback(() => {
    fetch('/api/hub/activity?count_only=1', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { unreadCount: 0 })
      .then(d => setUnreadActivity(d.unreadCount ?? 0))
      .catch(() => {})
  }, [])
  useEffect(() => { refreshActivity() }, [viewHref, refreshActivity])
  useEffect(() => {
    const id = setInterval(refreshActivity, 90_000)
    return () => clearInterval(id)
  }, [refreshActivity])

  // Authoritative unread refresh for the Hub rail icon dot (any unread room/DM)
  // + the Daily Log dot. Reads the same read-receipts endpoint the sidebar uses.
  // pathname is read via ref so this is a stable callback.
  const refreshHubUnread = useCallback(() => {
    fetch('/api/hub/read-receipts', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { unread_room_ids: [], unread_conv_ids: [], daily_log_unread: false })
      .then(d => {
        const any =
          (Array.isArray(d.unread_room_ids) && d.unread_room_ids.length > 0) ||
          (Array.isArray(d.unread_conv_ids) && d.unread_conv_ids.length > 0)
        setUnreadHub(any)
        // Don't show the Daily Log dot while the user is viewing Daily Log.
        const path = pathnameRef.current
        const onDailyLog = path === '/hub/daily-log' || path.startsWith('/hub/daily-log/')
        setDailyLogUnread(d.daily_log_unread === true && !onDailyLog)
      })
      .catch(() => {})
  }, [])

  // Refresh on every navigation; the 60s safety poll is a stable interval that
  // isn't recreated on each route change (NAV-HubShellEffects).
  useEffect(() => { refreshHubUnread() }, [viewHref, refreshHubUnread])
  useEffect(() => {
    const id = setInterval(refreshHubUnread, 60_000)
    return () => clearInterval(id)
  }, [refreshHubUnread])
  // Focus catch-up — a phone drops the realtime socket while it's locked, so a
  // message sent in that window lit nothing; re-read the moment the app is back.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshHubUnread() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshHubUnread])

  // Realtime: light the Hub rail icon dot the instant a new message arrives
  // (instead of waiting up to 60s for the poll). On a qualifying insert we pull
  // the authoritative read-receipts state so the dot also clears on read.
  // #26 — rides the shared HubMessagesProvider subscription (covers both the
  // postgres_changes insert and the admin-insert broadcast backstop) instead of
  // opening a 2nd whole-table `messages` channel on every device.
  useHubMessageInsert((msg) => {
    if (!msg.sender_id || msg.sender_id === currentUserId || msg.parent_id) return
    refreshHubUnread()
  })

  // Mark Daily Log read + clear the dot when the user opens it. (/hub/daily-log
  // only — Daily Log v2 lives at /hub/daily-log-v2 and is intentionally untouched.)
  useEffect(() => {
    const onDailyLog = viewHref === '/hub/daily-log' || viewHref.startsWith('/hub/daily-log/')
    if (!onDailyLog) return
    setDailyLogUnread(false)
    fetch('/api/hub/read-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_log: true }),
    }).catch(() => {})
  }, [viewHref])

  // Live Daily Log signal — company broadcast fired by the update-posted route.
  // daily_log_updates isn't in the Realtime publication, so this broadcast is
  // the instant path (the 60s poll above is the backstop). Only light the dot
  // if this user is one of the update's recipients and isn't already viewing it.
  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`daily-log:${companyId}`)
      .on('broadcast', { event: 'update-inserted' }, ({ payload }) => {
        const p = (payload ?? {}) as { recipient_ids?: string[]; sender_id?: string }
        if (p.sender_id === currentUserId) return
        if (!Array.isArray(p.recipient_ids) || !p.recipient_ids.includes(currentUserId)) return
        const path = pathnameRef.current
        if (path === '/hub/daily-log' || path.startsWith('/hub/daily-log/')) return
        setDailyLogUnread(true)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // pathname read via pathnameRef so we don't tear down + re-subscribe the
    // channel on every navigation (matches the HubSidebar messages pattern).
  }, [companyId, currentUserId])

  // Session 58.5: poll unheard voicemail count for the rail badge. Gated on
  // canAccessDialer so non-dialer users don't hit the endpoint.
  const unheardVoicemails = useHubVoicemailCount(!!canAccessDialer)

  // ── Txt2 unread dot ───────────────────────────────────────────────────────
  // Orange dot on the Txt2 rail icon when there's a newer customer inbound than
  // the last time this device opened Txt2 (per-device, like the chime pref).
  // Mirrors the Daily Log dot: 60s poll + the instant inbound broadcast.
  const TXT_SEEN_KEY = 'txt-last-seen'
  const refreshTxtUnread = useCallback(() => {
    if (!canAccessTxt) { setTxtUnread(false); return }
    const path = pathnameRef.current
    if (path === '/hub/txt' || path.startsWith('/hub/txt/')) { setTxtUnread(false); return }
    fetch('/api/txt/unread', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { latest_inbound_at: null, last_seen_at: null }))
      .then(d => {
        const latest: string | null = d.latest_inbound_at ?? null
        if (!latest) { setTxtUnread(false); return }
        // #45 — compare against the LATER of this device's local timestamp and
        // the server-side per-user "last opened" (set when ANY device opened
        // Txt2), so reading on one device clears the dot on the others.
        let seen = ''
        try { seen = localStorage.getItem(TXT_SEEN_KEY) || '' } catch { /* ignore */ }
        const serverSeen: string | null = d.last_seen_at ?? null
        if (serverSeen && serverSeen > seen) seen = serverSeen
        setTxtUnread(!seen || latest > seen)
      })
      .catch(() => {})
  }, [canAccessTxt])

  useEffect(() => { if (canAccessTxt) refreshTxtUnread() }, [viewHref, canAccessTxt, refreshTxtUnread])
  useEffect(() => {
    if (!canAccessTxt) return
    const id = setInterval(refreshTxtUnread, 60_000)
    return () => clearInterval(id)
  }, [canAccessTxt, refreshTxtUnread])

  // Instant: light the dot on the inbound broadcast (same topic the inbound
  // webhook fires; the daily-log dot uses this exact two-subscriber pattern).
  useEffect(() => {
    if (!canAccessTxt || !companyId) return
    // Ref-counted — several components share this topic and Supabase gives them
    // all one channel, so whoever unmounts first must not tear it down.
    return subscribeSharedBroadcast(`txt:${companyId}`, {
      inbound: (payload) => {
        const p = (payload ?? {}) as { recipient_ids?: string[] }
        // Only light the rail dot for users this inbound is actually for —
        // owner + members of an assigned thread, or the Queue audience while
        // unassigned. Mirrors the Daily Log dot's recipient gating above so a
        // claimed thread never dots anyone but its owner + members.
        if (Array.isArray(p.recipient_ids) && !p.recipient_ids.includes(currentUserId)) return
        // Already looking at Txt (by route OR as a Workspace Tab) → no dot.
        if (onTxtSurfaceRef.current) return
        setTxtUnread(true)
      },
      // #45 — when this user opens Txt2 on another device, clear the dot here too.
      seen: (payload) => {
        const p = (payload ?? {}) as { user_id?: string; seen_at?: string }
        if (p.user_id !== currentUserId) return
        if (p.seen_at) { try { localStorage.setItem(TXT_SEEN_KEY, p.seen_at) } catch { /* ignore */ } }
        setTxtUnread(false)
      },
    })
  }, [canAccessTxt, companyId, currentUserId])

  // Refresh the Txt2 dot when the tab/app regains focus — the realtime inbound
  // broadcast covers the live case, but if the socket dropped while backgrounded
  // (common on mobile) this catches up immediately instead of waiting up to 60s.
  useEffect(() => {
    if (!canAccessTxt) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshTxtUnread()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [canAccessTxt, refreshTxtUnread])

  // Clear + stamp last-seen when the user opens Txt2. #45 — also stamp the
  // server-side timestamp + broadcast so this user's OTHER devices clear too.
  // Fires on navigation AND on a tab switch, so opening a Txt thread as a tab
  // clears the rail dot and stamps last-seen the same way navigating there does.
  useEffect(() => {
    if (!onTxtSurface) return
    setTxtUnread(false)
    try { localStorage.setItem(TXT_SEEN_KEY, new Date().toISOString()) } catch { /* ignore */ }
    fetch('/api/txt/seen', { method: 'POST' }).catch(() => {})
  }, [viewHref, onTxtSurface, tabsApi.activeTab])

  // ── Shared Inbox unread dot ───────────────────────────────────────────────
  // Orange dot on the Inbox rail icon when inbound mail arrived that this user
  // should act on and is newer than the last time they opened the Inbox. Built
  // on the exact Txt pattern: 60s poll + the instant `new-mail` broadcast + a
  // focus catch-up, comparing against the LATER of a per-device stamp and the
  // server-side per-user timestamp so reading on one device clears the others.
  const INBOX_SEEN_KEY = 'inbox-last-seen'
  const refreshInboxUnread = useCallback(() => {
    if (!canAccessSharedInbox) { setInboxUnread(false); return }
    if (onInboxSurfaceRef.current) { setInboxUnread(false); return }
    fetch('/api/hub/email/unread', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { latest_inbound_at: null, last_seen_at: null }))
      .then(d => {
        const latest: string | null = d.latest_inbound_at ?? null
        if (!latest) { setInboxUnread(false); return }
        let seen = ''
        try { seen = localStorage.getItem(INBOX_SEEN_KEY) || '' } catch { /* ignore */ }
        const serverSeen: string | null = d.last_seen_at ?? null
        if (serverSeen && serverSeen > seen) seen = serverSeen
        setInboxUnread(!seen || latest > seen)
      })
      .catch(() => {})
  }, [canAccessSharedInbox])

  useEffect(() => { if (canAccessSharedInbox) refreshInboxUnread() }, [viewHref, canAccessSharedInbox, refreshInboxUnread])
  useEffect(() => {
    if (!canAccessSharedInbox) return
    const id = setInterval(refreshInboxUnread, 60_000)
    return () => clearInterval(id)
  }, [canAccessSharedInbox, refreshInboxUnread])

  // Instant: light the dot on the same `new-mail` broadcast the chime listens to
  // (fired only for genuinely new inbound mail, never for the interactive
  // `update` nudge), and clear it when this user opens the Inbox elsewhere.
  useEffect(() => {
    if (!canAccessSharedInbox || !companyId) return
    // Ref-counted — the Inbox sidebar, the chime and any open thread share this
    // topic, so whoever unmounts first must not tear it down.
    return subscribeSharedBroadcast(`inbox:${companyId}`, {
      'new-mail': (payload) => {
        const p = (payload ?? {}) as { recipient_ids?: string[] }
        // Only light for users this mail is actually for — assignee + members of
        // an assigned thread, or the queue audience while unassigned. A thread
        // someone else already owns never dots anyone but its own people.
        if (Array.isArray(p.recipient_ids) && !p.recipient_ids.includes(currentUserId)) return
        if (onInboxSurfaceRef.current) return
        setInboxUnread(true)
      },
      seen: (payload) => {
        const p = (payload ?? {}) as { user_id?: string; seen_at?: string }
        if (p.user_id !== currentUserId) return
        if (p.seen_at) { try { localStorage.setItem(INBOX_SEEN_KEY, p.seen_at) } catch { /* ignore */ } }
        setInboxUnread(false)
      },
    })
  }, [canAccessSharedInbox, companyId, currentUserId])

  // Focus catch-up — the broadcast covers the live case, but if the socket
  // dropped while backgrounded this beats waiting up to 60s.
  useEffect(() => {
    if (!canAccessSharedInbox) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshInboxUnread()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [canAccessSharedInbox, refreshInboxUnread])

  // Clear + stamp last-seen when the user opens the Inbox, locally and on the
  // server (so this user's other devices clear too).
  useEffect(() => {
    if (!onInboxSurface) return
    setInboxUnread(false)
    try { localStorage.setItem(INBOX_SEEN_KEY, new Date().toISOString()) } catch { /* ignore */ }
    fetch('/api/hub/email/seen', { method: 'POST' }).catch(() => {})
  }, [viewHref, onInboxSurface])

  // ── Dialer missed-call dot ────────────────────────────────────────────────
  // Orange dot on the Dialer rail icon when there's a missed inbound call newer
  // than the last time this device opened the Dialer. Distinct from the red
  // unheard-voicemail count badge (a missed call may not leave a voicemail).
  const latestMissedAt = useHubMissedCall(!!canAccessDialer)
  const DIALER_SEEN_KEY = 'dialer-missed-seen'
  useEffect(() => {
    const onDialer = viewHref === '/hub/dialer' || viewHref.startsWith('/hub/dialer/')
    if (onDialer) {
      setMissedCall(false)
      try { localStorage.setItem(DIALER_SEEN_KEY, latestMissedAt || new Date().toISOString()) } catch { /* ignore */ }
      return
    }
    if (!latestMissedAt) { setMissedCall(false); return }
    let seen = ''
    try { seen = localStorage.getItem(DIALER_SEEN_KEY) || '' } catch { /* ignore */ }
    setMissedCall(!seen || latestMissedAt > seen)
  }, [latestMissedAt, viewHref])

  // Whether to lift the Twilio Device registration up to shell level. When
  // false, IncomingCall only renders on /hub/dialer (original Session 56
  // behavior, e.g. user opted out via Settings or doesn't have dialer access).
  const liftDialerDevice = !!canAccessDialer && (dialerGlobalRing !== false)

  // Clocked-in status: refresh from API on focus + after Time Clock modal closes
  // (the modal handles the punch itself). Initial value comes from server props.
  const refreshClockedIn = useCallback(() => {
    fetch('/api/timesheet/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.clocked_in != null) setIsClockedIn(!!d.clocked_in) })
      .catch(() => {})
  }, [])
  useEffect(() => {
    const onFocus = () => refreshClockedIn()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshClockedIn])

  const handleConversationCreated = useCallback(() => {
    window.dispatchEvent(new CustomEvent(HUB_CONV_CREATED_EVENT))
  }, [])

  const closeMobileDrawer = useCallback(() => setMobileDrawerOpen(false), [])

  // Persist the customizable Hub launcher layout (rail + mobile bar). Optimistic:
  // the rail/bar update instantly behind the editor, reverting only on failure.
  const saveLayout = useCallback(async (next: HubLayout) => {
    setLiveLayout(prev => {
      const rollback = prev
      layoutSavingRef.current = true
      fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub_layout: next }),
      })
        .then(res => { if (!res.ok) setLiveLayout(rollback) })
        .catch(() => setLiveLayout(rollback))
        .finally(() => { layoutSavingRef.current = false })
      return next
    })
  }, [])

  // NAV-PermGrant: when the server sends a changed layout (new auto-seeded app after a
  // permission grant), adopt it — but never while the user has an edit in flight.
  useEffect(() => {
    if (!initialLayout) return
    const serialized = JSON.stringify(initialLayout)
    if (serialized === lastSyncedLayoutRef.current) return
    lastSyncedLayoutRef.current = serialized
    if (layoutSavingRef.current) return
    setLiveLayout(initialLayout)
  }, [initialLayout])

  // Master DND quick-toggle (sys:dnd). Sets master_dnd_enabled + mirrors hub status dot.
  const toggleDnd = useCallback(() => {
    setMasterDndEnabled(prev => {
      const next = !prev
      const nextStatus = next ? 'dnd' : 'available'
      fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ master_dnd_enabled: next }),
      }).then(res => { if (!res.ok) setMasterDndEnabled(prev) }).catch(() => setMasterDndEnabled(prev))
      fetch('/api/hub/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      }).then(res => { if (res.ok) setLiveStatus(nextStatus) }).catch(() => {})
      return next
    })
  }, [])

  // Set master_dnd_enabled to an explicit value WITHOUT touching the status dot.
  // Used to mirror a status change made from the You menu (DND status ⟹ ALL DND on,
  // any other status ⟹ ALL DND off) — the status itself was already written by the
  // Status picker, so we only sync the flag here.
  const applyMasterDndFlag = useCallback((on: boolean) => {
    setMasterDndEnabled(prev => {
      if (prev === on) return prev
      fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ master_dnd_enabled: on }),
      }).then(res => { if (!res.ok) setMasterDndEnabled(prev) }).catch(() => setMasterDndEnabled(prev))
      return on
    })
  }, [])

  // Hub notifications DND quick-toggle (sys:hub-dnd). Silences Hub push only.
  const toggleHubDnd = useCallback(() => {
    setHubDndEnabled(prev => {
      const next = !prev
      fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub_dnd_enabled: next }),
      }).then(res => { if (!res.ok) setHubDndEnabled(prev) }).catch(() => setHubDndEnabled(prev))
      return next
    })
  }, [])

  // Dialer DND quick-toggle (sys:dialer-dnd). Silences inbound calls only.
  const toggleDialerDnd = useCallback(() => {
    setDialerDndEnabled(prev => {
      const next = !prev
      fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dialer_dnd_enabled: next }),
      }).then(res => { if (!res.ok) setDialerDndEnabled(prev) }).catch(() => setDialerDndEnabled(prev))
      return next
    })
  }, [])

  const { grants, showAdmin: showAdminRail } = resolveAdminGrants(adminGrants, !!isAdmin)

  const permissions: RailPermissions = {
    isAdmin: !!isAdmin,
    canAccessTracker: !!canAccessTracker,
    canAccessRouting: !!canAccessRouting,
    canAccessFleet: !!canAccessFleet,
    canAccessLawn: !!canAccessLawn,
    canAccessCallLog: !!canAccessCallLog,
    canAccessCallLog2: !!canAccessCallLog2,
    canAccessTimesheet: !!canAccessTimesheet,
    canAccessDialer: !!canAccessDialer,
    canAccessTxt: !!canAccessTxt,
    canAccessMarketing: !!canAccessMarketing,
    canAccessEmail: !!canAccessEmail,
    canAccessSharedInbox: !!canAccessSharedInbox,
    canManageDrip: !!canManageDrip,
    canAccessForms: !!canAccessForms,
    canAccessDailyLogV2: !!canAccessDailyLogV2,
    canAccessScoreboards: !!canAccessScoreboards,
    canAccessReports: !!canAccessReports,
    canAccessFiles: !!canAccessFiles,
    canAccessPesticideRecords: !!canAccessPesticideRecords,
    canAccessPricer: !!canAccessPricer,
    canAccessQuotes: !!canAccessQuotes,
    canAccessHub: !!canAccessHub,
  }

  // Persistent client twin for a kept-alive workspace tab. Each twin self-fetches
  // its own data (needs no server props); the few scalar props come from the
  // shell. Only Tier-1 screens are wired for now (see HUB_WORKSPACE_TABS_PRD.md).
  function renderTabContent(t: WorkspaceTab) {
    switch (t.catalogId) {
      case 'contacts':
        return <ContactsPanel initialContacts={[]} initialTags={[]} />
      case 'pricer':
        return <PricerView />
      case 'scoreboards':
        return t.instanceKey
          ? <ScoreboardBoardTab slug={t.instanceKey} />
          : <ScoreboardsIndexTab allowedSlugs={scoreboardSlugs ?? []} isAdmin={!!isAdmin} />
      case 'tracker':
        return <TrackerLeadsTab
          currentUser={{ email: userEmail, name: currentUserDisplayName ?? userEmail.split('@')[0], isAdmin: !!isAdmin }}
          canCall={!!isAdmin || !!canAccessDialer}
          canText={!!isAdmin || !!canAccessTxt}
          canQuote={!!canAccessQuotes}
        />
      case 'routing':
        return <RoutingTab />
      case 'board':
        return t.instanceKey ? <BoardTab boardId={t.instanceKey} hubUsers={hubUsers} currentUserId={currentUserId} /> : null
      case 'daily-log-v2':
        return <DailyLogV2View currentUserId={currentUserId} {...(workOrderPerms ?? { isAdmin: !!isAdmin, canAccessIrrigation: !!isAdmin, canCall: !!isAdmin, canText: !!isAdmin, canQuote: !!isAdmin })} />
      case 'room':
        return t.instanceKey ? <ChatTab roomId={t.instanceKey} label={t.label} currentUserId={currentUserId} hubUsers={hubUsers} isAdmin={!!isAdmin} rooms={rooms.map(r => ({ id: r.id, name: r.name }))} /> : null
      case 'dm':
        return t.instanceKey ? <ChatTab conversationId={t.instanceKey} label={t.label} currentUserId={currentUserId} hubUsers={hubUsers} isAdmin={!!isAdmin} rooms={rooms.map(r => ({ id: r.id, name: r.name }))} /> : null
      case 'txt-thread':
        return t.instanceKey ? <TxtTab conversationId={t.instanceKey} currentUserId={currentUserId} companyId={companyId ?? ''} hubUsers={hubUsers} currentUserName={currentUserDisplayName ?? null} canAssign={!!canManageTxt} canAccessDialer={!!canAccessDialer} canAccessUnifiedInbox={!!canAccessUnifiedInbox} /> : null
      case 'inbox-thread':
        return t.instanceKey ? <EmailThreadView threadId={t.instanceKey} currentUserId={currentUserId} companyId={companyId ?? ''} emailSignature="" /> : null
      default:
        return null
    }
  }

  // Resolver inputs for the tab effects above (read through a ref — see there).
  resolveCtxRef.current = { rooms, conversations: railConversations, currentUserId, permissions }

  // ── Opening apps (rail, Menu, New) ─────────────────────────────────────────
  // An APP opens like an app, not a link: go to the most recent tab of it if one
  // is open (Alt-click forces another), otherwise open it. Without tabs it's the
  // plain navigation it always was.
  const openApp = (id: string, href: string, newCopy = false) => {
    setShowMenu(false)
    const api = tabsApiRef.current
    const ctx = resolveCtxRef.current
    if (!api.enabled || !ctx) { router.push(href); return }
    if (id === 'hub') {
      if (!newCopy) {
        const chats = api.peek().tabs.filter(t => t.catalogId === 'room' || t.catalogId === 'dm' || appKeyFromPath(t.href) === 'chat')
        if (chats.length) {
          api.activateTab(chats.reduce((x, y) => (y.lastActiveSeq > x.lastActiveSeq ? y : x)).id)
          return
        }
      }
      openHref('/hub')
      return
    }
    // Help lives outside the Hub's pages but still opens as a tab.
    if (href === '/help') { api.openApp({ catalogId: 'help', label: 'Help', href, kind: 'page', newCopy }); return }
    const r = resolveTabHref(href, ctx)
    if (!r || r.action === 'window') { router.push(href); return }
    api.openApp({ ...r.input, newCopy: newCopy && !CONVERSATION_TABS.has(r.input.catalogId) })
  }

  // ── The pop-up phone ───────────────────────────────────────────────────────
  // Desktop, with the shell's phone registered: the rail's Dialer and every
  // click-to-call open a small phone over whatever you're doing (the number filled
  // in, you press Call) instead of leaving the screen. The full Dialer — history,
  // voicemail — is one click away in it. Calls stay in the call bar on every tab.
  const [phone, setPhone] = useState<{ open: boolean; number: string; conversationId: string | null; contactId: string | null; nonce: number }>({ open: false, number: '', conversationId: null, contactId: null, nonce: 0 })
  const phonePopup = isDesktop && liftDialerDevice
  useEffect(() => {
    if (!phonePopup) return
    registerDialHandler(req => setPhone(p => ({ open: true, number: req.number, conversationId: req.conversationId ?? null, contactId: req.contactId ?? null, nonce: p.nonce + 1 })))
    return () => registerDialHandler(null)
  }, [phonePopup])
  const onRailDialer = (): boolean => {
    if (!phonePopup) return false
    setPhone(p => (p.open ? { ...p, open: false } : { open: true, number: '', conversationId: null, contactId: null, nonce: p.nonce + 1 }))
    return true
  }

  // ── Page tabs (frames) talk to the window through these ───────────────────
  const frameHandlers: PageTabFrameHandlers = {
    onNav: (tabId, href) => tabsApi.updateTab(tabId, { href }),
    onTitle: (tabId, title) => {
      const t = tabsApi.peek().tabs.find(x => x.id === tabId)
      // Only a page that names itself (a customer's file) relabels its tab.
      if (t && t.href.startsWith('/hub/contacts/')) tabsApi.updateTab(tabId, { label: title })
    },
    onOpen: href => openHref(href),
    onOpenTab: input => { tabsApi.openTab({ ...input, catalogId: input.catalogId as TabCatalogId }) },
    onDial: req => requestDial(req, href => router.push(href)),
    onKey: k => {
      if (k.key === 'k') { toggleSearch(); return }
      const n = parseInt(k.key, 10)
      const ordered = tabsInStripOrder(tabsApi.peek().tabs)
      if (Number.isInteger(n) && ordered[n - 1]) tabsApi.activateTab(ordered[n - 1].id)
    },
    onCompose: openSearch,
  }

  // ── Drag a tab onto the screen to split ──────────────────────────────────
  // While a tab is being dragged from the strip, two drop zones cover the screen
  // (above the page frames, which would otherwise swallow the drop): left puts
  // the tab in front with the one you were on beside it; right puts it beside.
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null)
  useEffect(() => {
    const onDrag = (e: Event) => {
      setDragTabId((e as CustomEvent<string | null>).detail ?? null)
      setDropSide(null)
    }
    window.addEventListener(TAB_DRAG_EVENT, onDrag)
    return () => window.removeEventListener(TAB_DRAG_EVENT, onDrag)
  }, [])
  const dropTab = (id: string, side: 'left' | 'right') => {
    const live = tabsApi.peek()
    if (!live.tabs.some(t => t.id === id)) return
    const active = live.activeTabId
    const split = live.splitTabId && live.splitTabId !== active ? live.splitTabId : null
    if (side === 'right') {
      // Dragging the tab you're on to the right moves it there and brings your
      // last tab in on the left (setSplit handles that case).
      if (id !== split) tabsApi.setSplit(id)
      return
    }
    if (id === active) return
    if (id === split) { tabsApi.activateTab(id); return } // swap sides
    tabsApi.activateTab(id)
    if (active) tabsApi.setSplit(active)
  }
  const onDropZone = (side: 'left' | 'right') => (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData(TAB_DRAG_MIME) || dragTabId
    setDragTabId(null)
    setDropSide(null)
    if (id) dropTab(id, side)
  }

  // ── Which sidebar ─────────────────────────────────────────────────────────
  // With tabs, a tab shows a sidebar only if its screen has one: the section
  // sidebars (Admin, Reports, Txt, …) and the Hub chat sidebar for rooms / DMs /
  // Boards. A page tab running in a frame brings its own. Everything else uses
  // the whole width. Without tabs it's exactly the old rule (the URL's section).
  function sidebarRailFor(t: WorkspaceTab | null): RailId | null {
    if (manualRail === 'profile') return 'profile'
    if (!tabsApi.enabled) return activeRail
    if (!t) return null
    if (t.kind === 'page' && t.id !== tabsApi.routeTabId) {
      if (isWindowOnlyPath(t.href)) return null
      const ctx = resolveCtxRef.current
      const r = ctx ? resolveTabHref(t.href, ctx) : null
      if (!(r && r.action === 'tab' && r.input.kind !== 'page')) return null
    }
    const rail = tabRail(t)
    if (SECTION_SIDEBAR_RAILS.has(rail)) return rail
    const app = appKeyFromPath(t.href)
    if (app === 'chat' || app === 'board' || t.catalogId === 'room' || t.catalogId === 'dm' || t.catalogId === 'board') return 'hub'
    return null
  }
  const sidebarRail = sidebarRailFor(tabsApi.activeTab)

  function renderSidebar(rail: RailId) {
    const collapseProps = { onDesktopCollapse: toggleSidebarCollapsed }
    if (rail === 'profile') {
      return (
        <ProfileSidebar
          userId={currentUserId}
          displayName={currentUserDisplayName ?? userEmail.split('@')[0]}
          userEmail={userEmail}
          avatarUrl={currentUserAvatarUrl ?? null}
          initialStatus={liveStatus}
          textSize={textSize}
          onTextSizeChange={setTextSize}
          theme={theme}
          onThemeChange={setTheme}
          onOpenNotifPrefs={() => setShowNotifPrefs(true)}
          onOpenActivity={() => { closeMobileDrawer(); setShowActivity(true) }}
          unreadActivity={unreadActivity}
          onStatusChanged={s => { setLiveStatus(s ?? null); applyMasterDndFlag(s === 'dnd') }}
          masterDndOn={masterDndEnabled}
          hubDndOn={hubDndEnabled}
          dialerDndOn={dialerDndEnabled}
          onToggleMasterDnd={toggleDnd}
          onToggleHubDnd={toggleHubDnd}
          onToggleDialerDnd={toggleDialerDnd}
          onClose={closeMobileDrawer}
          {...collapseProps}
        />
      )
    }
    if (SECTION_SIDEBAR_RAILS.has(rail)) {
      return (
        <HubSectionSidebar
          rail={rail}
          onClose={closeMobileDrawer}
          onDesktopCollapse={toggleSidebarCollapsed}
          isAdmin={!!isAdmin}
          isPlatformAdmin={isPlatformAdmin}
          billingEnabled={billingEnabled}
          grants={grants}
          canAccessTxt={!!canAccessTxt}
          canManageTxt={!!canManageTxt}
          canAccessDialer={!!canAccessDialer}
          canAccessUnifiedInbox={!!canAccessUnifiedInbox}
          canAccessMarketing={!!canAccessMarketing}
          canAccessEmail={!!canAccessEmail}
          canManageDrip={!!canManageDrip}
          canAdminMarketing={!!canAdminMarketing}
          canAdminEmail={!!canAdminEmail}
          canAccessBeta={!!canAccessBeta}
          currentUserId={currentUserId}
          companyId={companyId || ''}
          scoreboardSlugs={scoreboardSlugs}
          reportSlugs={reportSlugs}
        />
      )
    }
    // hub + every other catalog id (routing, etc.) → Hub sidebar
    return (
      <HubSidebar
        rooms={rooms}
        userEmail={userEmail}
        currentUserId={currentUserId}
        hubUsers={hubUsers}
        currentUserStatus={liveStatus}
        currentUserDisplayName={currentUserDisplayName}
        isAdmin={isAdmin}
        onClose={closeMobileDrawer}
        onDesktopCollapse={toggleSidebarCollapsed}
        textSize={textSize}
        onTextSizeChange={setTextSize}
        initialPinnedIds={initialPinnedIds ?? []}
        canAccessTracker={canAccessTracker}
        canAdminAi={grants.ai}
        canAccessCallLog={canAccessCallLog}
        canAccessLawn={canAccessLawn}
        canAccessDialer={canAccessDialer}
        canAccessTimesheet={canAccessTimesheet}
        canAccessRouting={canAccessRouting}
        canAccessFleet={canAccessFleet}
        canAccessDailyLogV2={canAccessDailyLogV2}
        dailyLogUnread={dailyLogUnread}
        myPresenceMode={myPresenceMode}
        onOpenTimeClock={() => { closeMobileDrawer(); setShowTimeClock(true) }}
      />
    )
  }

  // Landing page has no useful sidebar — hide the in-flow sidebar there.
  // Otherwise show unless explicitly collapsed (or the tab has none).
  const hideSidebarDesktop = !sidebarRail || viewHref.startsWith('/hub/home') || sidebarCollapsed
  // Inert when sidebar is collapsed on desktop, so its inner buttons aren't
  // focusable / hit-testable while it's at 0 width.
  const sidebarInert = hideSidebarDesktop && !mobileDrawerOpen

  // ── The tab stack ─────────────────────────────────────────────────────────
  // Every AWAKE tab stays MOUNTED (state preserved); only the ones on screen are
  // visible, via a display toggle — NEVER conditional render, which would unmount
  // and lose scroll/filters/drafts. Asleep tabs aren't mounted at all.
  //
  // The window's own route (`children`) always sits FIRST, in the same place in
  // the tree whether or not tabs are on, so turning tabs on at load (the desktop
  // check runs after hydration) never remounts the page you landed on. It's
  // UNMOUNTED (not just hidden) when no tab holds it, so its realtime channels
  // are released — otherwise opening a tab for the conversation the route shows
  // double-subscribes the shared Supabase topic and throws.
  const splitId = tabsApi.splitTabId && tabsApi.splitTabId !== tabsApi.activeTabId ? tabsApi.splitTabId : null
  const isOnScreen = (id: string) => id === tabsApi.activeTabId || id === splitId
  const routeTab = tabsApi.routeTabId ? tabsApi.tabs.find(t => t.id === tabsApi.routeTabId) ?? null : null
  const showRouteSlot = !tabsApi.enabled || !routeReady || (!!routeTab && tabsApi.awakeIds.has(routeTab.id))
  const routeVisible = !tabsApi.enabled || !routeReady || (!!routeTab && isOnScreen(routeTab.id))

  function paneHeader(t: WorkspaceTab) {
    if (!splitId) return null
    const isSplit = t.id === splitId
    return (
      <div className="flex-none h-8 flex items-center gap-2 px-3 border-b border-white/10 bg-white/[0.02] text-[12px] text-white/60">
        <span className="truncate flex-1 font-medium text-white/75">{t.label}</span>
        {isSplit && (
          <>
            <button type="button" onClick={() => tabsApi.activateTab(t.id)} className="px-2 py-0.5 rounded hover:bg-white/10 hover:text-white">Swap</button>
            <button type="button" onClick={() => tabsApi.setSplit(null)} className="px-2 py-0.5 rounded hover:bg-white/10 hover:text-white">Close split</button>
          </>
        )}
      </div>
    )
  }

  function renderTabBody(t: WorkspaceTab, visible: boolean) {
    if (t.kind !== 'page') return renderTabContent(t)
    if (isWindowOnlyPath(t.href)) return <div className="flex-1 min-h-0 p-6 text-sm text-white/40">Opening {t.label}…</div>
    const ctx = resolveCtxRef.current
    const r = ctx ? resolveTabHref(t.href, ctx) : null
    if (r && r.action === 'tab' && r.input.kind !== 'page') {
      return renderTabContent({ ...t, catalogId: r.input.catalogId, instanceKey: r.input.instanceKey })
    }
    return <PageTabFrame tabId={t.id} href={t.href} visible={visible} label={t.label} handlers={frameHandlers} />
  }

  // Top bar: New + the menu's "+" both start things.
  const newItems: { key: string; label: string; onClick: () => void }[] = [
    { key: 'message', label: 'New message', onClick: openSearch },
  ]
  const startNew = (kind: HubIntentKind, id: string, href: string) => {
    openApp(id, href)
    // After the tab is in front, so a page tab that's already open is "visible"
    // and gets the request; a screen that's still mounting picks it up on mount.
    setTimeout(() => requestHubIntent(kind), 60)
  }
  if (canAccessTxt) newItems.push({ key: 'text', label: 'New text', onClick: () => startNew('new-text', 'txt2', '/hub/txt') })
  if (canAccessTracker) newItems.push({ key: 'lead', label: 'New lead', onClick: () => startNew('new-lead', 'tracker', '/hub/tracker') })
  if (canAccessHub) newItems.push({ key: 'contact', label: 'New contact', onClick: () => startNew('new-contact', 'contacts', '/hub/contacts') })
  if (canAccessQuotes) newItems.push({ key: 'quote', label: 'New quote', onClick: () => openHref('/hub/quotes/new') })

  const shell = (
    <>
    {/* paddingTop: room for the radio bar, which floats at the very top while a
        channel is open (0px otherwise — see RadioBar / globals.css). */}
    <div className="hub-root flex h-[100dvh] bg-gray-950 text-white overflow-hidden" style={{ paddingTop: 'var(--radio-bar-h, 0px)' }}>
      {mobileDrawerOpen && (
        <div
          className="fixed left-0 right-0 top-0 z-40 bg-black/60 md:hidden"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 56px)' }}
          onClick={closeMobileDrawer}
        />
      )}

      <HubRail
        showAdmin={showAdminRail}
        unreadActivity={unreadActivity}
        unreadHub={unreadHub}
        dailyLogUnread={dailyLogUnread}
        txtUnread={txtUnread}
        inboxUnread={inboxUnread}
        missedCall={missedCall}
        unheardVoicemails={unheardVoicemails}
        isClockedIn={isClockedIn}
        onSearchClick={openSearch}
        onProfileClick={() => { setManualRail('profile') }}
        onTimeClockClick={() => setShowTimeClock(true)}
        onActivityClick={() => setShowActivity(true)}
        onOpenLauncher={() => setShowMenu(v => !v)}
        onOpenApp={tabsApi.enabled ? openApp : undefined}
        onDialerClick={onRailDialer}
        phoneOpen={phone.open}
        onToggleDnd={toggleDnd}
        onToggleHubDnd={toggleHubDnd}
        onToggleDialerDnd={toggleDialerDnd}
        masterDndOn={masterDndEnabled}
        hubDndOn={hubDndEnabled}
        dialerDndOn={dialerDndEnabled}
        onOpenLayoutEditor={() => setShowLayoutEditor(true)}
        currentUserId={currentUserId}
        currentUserDisplayName={currentUserDisplayName}
        currentUserAvatarUrl={currentUserAvatarUrl ?? null}
        currentUserStatus={liveStatus}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        onOpenSidebar={openSidebar}
        activeManualRail={manualRail}
        permissions={permissions}
        items={liveLayout.items}
        rooms={rooms}
        conversations={railConversations}
        launcherOpen={showMenu}
        activeRailOverride={tabsApi.activeTab ? tabRail(tabsApi.activeTab) : undefined}
      />

      {/* Everything right of the rail: the top bar and tab strip run across the
          whole width (desktop), then the sidebar + the screen. */}
      <div className="flex-1 min-w-0 flex flex-col">
        <HubTopBar
          onSearch={openSearch}
          unreadActivity={unreadActivity}
          onBell={() => setShowActivity(true)}
          newItems={newItems}
        />

        {/* Workspace Tabs strip — renders only when the feature is on AND ≥1 tab
            is open. */}
        <WorkspaceTabStrip onNewTab={() => setShowMenu(true)} />

        <div className="flex-1 min-h-0 flex relative">
          <div
            className={`
              fixed top-0 left-0 z-50 md:relative md:z-auto md:inset-y-0 md:bottom-auto
              transform transition-transform duration-200 ease-in-out
              ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
              md:overflow-hidden
              ${hideSidebarDesktop ? 'md:w-0' : 'md:w-72'}
            `}
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 56px)' }}
            aria-hidden={sidebarInert ? true : undefined}
            inert={sidebarInert ? true : undefined}
          >
            {/* Mobile has no tabs: the drawer always shows the URL's section. */}
            {renderSidebar(sidebarRail ?? activeRail)}
          </div>

          {/* Mobile: persistent "open sidebar" chevron, upper-left, on EVERY Hub
              screen while the drawer is closed. Apps launched from the Apps drawer
              (tracker, fleet, daily-log, files, …) have no bottom-bar button to
              reveal their sidebar — this floating chevron is the universal way in,
              and it also replaces the room/DM/client header (hidden via
              data-hide-on-keyboard) while the soft keyboard is up. Page headers are
              padded left on mobile so it never overlaps content — chat headers via
              the global [data-hide-on-keyboard] rule in globals.css, tool headers
              via per-page max-md:pl-14. setManualRail(null) makes the drawer render
              the current page's own sidebar. */}
          {!mobileDrawerOpen && (
            <button
              type="button"
              onClick={() => { setManualRail(null); setMobileDrawerOpen(true) }}
              className="md:hidden fixed left-2 z-40 w-9 h-9 rounded-full bg-gray-900/80 backdrop-blur border border-white/10 text-white/80 hover:text-white flex items-center justify-center shadow-lg"
              style={{ top: 'calc(var(--hub-overlay-top) + 6px)' }}
              aria-label="Open sidebar"
              title="Menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Desktop-only reopen chevron — visible whenever the sidebar is
              collapsed and the screen in front has one. */}
          {sidebarCollapsed && !!sidebarRail && !viewHref.startsWith('/hub/home') && (
            <button
              onClick={toggleSidebarCollapsed}
              className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-30 items-center justify-center w-5 h-12 bg-[var(--t-sidebar)] hover:bg-[var(--t-sidebar-hover)] border-y border-r border-white/10 rounded-r text-white/80 hover:text-white transition-colors"
              aria-label="Show sidebar"
              title="Show sidebar"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* Main content */}
          <div className="hub-main flex-1 flex flex-col min-w-0 overflow-hidden relative">
            {/* Mobile safe-area-top spacer — there is no top chrome anymore, so
                content would otherwise bleed under the iOS notch / Dynamic Island. */}
            <div
              className="md:hidden flex-none"
              style={{ height: 'var(--hub-safe-top)' }}
              aria-hidden="true"
            />

            {/* Radio: the bar along the top while a channel is open — hold to talk from
                any Hub page. Fixed-position (it has to sit above the full-screen Work
                Order views), so it takes no room here; hub-root's padding makes it. */}
            <RadioBar />

            {/* Desktop Dialer Control S1: persistent global call bar with inline
                controls (Mute / Hold / Transfer / End) + expand-to-full-dialer.
                Shows on every tab while a call is up (hidden only while the Dialer
                itself is on screen). */}
            <GlobalCallBar />

            {/* Announcement ticker — Hub-section screens only. */}
            {activeRail === 'hub' && !viewHref.startsWith('/hub/home') && (
              <AnnouncementTicker
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                initialActive={initialActiveAnnouncements ?? []}
              />
            )}

            <div
              className="relative flex-1 min-h-0 overflow-hidden flex"
              style={{
                // Mobile: leave room for the bottom tab bar (~56px + safe area).
                // Desktop: no bottom bar, no padding — otherwise the composer
                // would have a huge gap below it.
                paddingBottom: isMobile
                  ? (keyboardOpen ? 'env(safe-area-inset-bottom, 0)' : 'calc(env(safe-area-inset-bottom, 0) + 56px)')
                  : 0,
              }}
            >
              {showRouteSlot && (
                <div
                  key="route"
                  className={`flex-1 min-h-0 min-w-0 flex-col ${routeTab && routeTab.id === splitId ? 'border-l border-white/10' : ''}`}
                  style={{ display: routeVisible ? 'flex' : 'none', order: routeTab && routeTab.id === splitId ? 2 : 1 }}
                >
                  {routeTab && paneHeader(routeTab)}
                  <WorkspaceTabInstanceProvider tabId={routeTab?.id ?? 'route'} isActive={routeVisible}>
                    {children}
                  </WorkspaceTabInstanceProvider>
                </div>
              )}
              {tabsApi.tabs.filter(t => t.id !== tabsApi.routeTabId && tabsApi.awakeIds.has(t.id)).map(t => {
                const visible = isOnScreen(t.id)
                return (
                  <div
                    key={t.id}
                    className={`flex-1 min-h-0 min-w-0 flex-col ${t.id === splitId ? 'border-l border-white/10' : ''}`}
                    style={{ display: visible ? 'flex' : 'none', order: t.id === splitId ? 2 : 1 }}
                  >
                    {paneHeader(t)}
                    {/* Tells this tab's subtree whether the user can actually see it.
                        A hidden tab is still mounted and still runs its effects, so
                        without this its conversation marks itself read and pins its
                        feed against a zero-height (invisible) scroll box. */}
                    <WorkspaceTabInstanceProvider tabId={t.id} isActive={visible}>
                      <WorkspaceTabErrorBoundary label={t.label} resetKey={t.id}>
                        {renderTabBody(t, visible)}
                      </WorkspaceTabErrorBoundary>
                    </WorkspaceTabInstanceProvider>
                  </div>
                )
              })}
              {dragTabId && tabsApi.tabs.length > 1 && (
                <div className="absolute inset-0 z-40 flex gap-2 p-2 bg-black/20" aria-hidden="true">
                  {(['left', 'right'] as const).map(side => (
                    <div
                      key={side}
                      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropSide !== side) setDropSide(side) }}
                      onDragLeave={() => setDropSide(s => (s === side ? null : s))}
                      onDrop={onDropZone(side)}
                      className={`flex-1 rounded-xl border-2 border-dashed flex items-center justify-center text-sm font-semibold transition-colors ${
                        dropSide === side ? 'border-[var(--brand)] bg-[var(--brand)]/20 text-white' : 'border-white/25 bg-gray-950/50 text-white/70'
                      }`}
                    >
                      {side === 'left' ? 'Open on the left' : 'Open on the right'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <HubMobileBar
        onMoreClick={() => setShowMobileMore(true)}
        onHubClick={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        onPhoneClick={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        onUserSlotNav={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        onTimeClockClick={() => setShowTimeClock(true)}
        onToggleDnd={toggleDnd}
        onToggleHubDnd={toggleHubDnd}
        onToggleDialerDnd={toggleDialerDnd}
        masterDndOn={masterDndEnabled}
        hubDndOn={hubDndEnabled}
        dialerDndOn={dialerDndEnabled}
        isClockedIn={isClockedIn}
        unreadHub={unreadHub}
        unheardVoicemails={unheardVoicemails}
        txtUnread={txtUnread}
        inboxUnread={inboxUnread}
        missedCall={missedCall}
        dailyLogUnread={dailyLogUnread}
        permissions={permissions}
        rooms={rooms}
        conversations={railConversations}
        currentUserStatus={liveStatus}
        hidden={keyboardOpen}
        drawerOpen={mobileDrawerOpen}
        activeManualRail={manualRail}
        onCloseDrawer={closeMobileDrawer}
      />
    </div>

    {showCompose && (
      <HubQuickCompose
        onClose={() => setShowCompose(false)}
        anchor={searchAnchor}
        onNavigate={tabsApi.enabled ? href => openHref(href) : undefined}
        rooms={rooms}
        hubUsers={hubUsers}
        currentUserId={currentUserId}
        conversations={railConversations}
        onConversationCreated={handleConversationCreated}
        permissions={permissions}
        showAdmin={showAdminRail}
      />
    )}
    {showTimeClock && (
      <TimesheetClockModal
        onClose={() => { setShowTimeClock(false); refreshClockedIn() }}
      />
    )}
    {showNotifPrefs && <NotifPrefsModal onClose={() => setShowNotifPrefs(false)} />}
    {showMobileMore && (
      <HubMobileMore
        onClose={() => setShowMobileMore(false)}
        showAdmin={showAdminRail}
        unreadActivity={unreadActivity}
        onSearchClick={() => { setShowMobileMore(false); setShowCompose(true) }}
        onProfileClick={() => { setShowMobileMore(false); setManualRail('profile'); setMobileDrawerOpen(true) }}
        onActivityClick={() => { setShowMobileMore(false); setShowActivity(true) }}
        onTimeClockClick={() => { setShowMobileMore(false); setShowTimeClock(true) }}
        onToggleDnd={toggleDnd}
        onToggleHubDnd={toggleHubDnd}
        onToggleDialerDnd={toggleDialerDnd}
        masterDndOn={masterDndEnabled}
        hubDndOn={hubDndEnabled}
        dialerDndOn={dialerDndEnabled}
        onOpenLayoutEditor={() => { setShowMobileMore(false); setShowLayoutEditor(true) }}
        onOpenSidebarApp={() => { setManualRail(null); setMobileDrawerOpen(true) }}
        permissions={permissions}
        items={liveLayout.items}
        rooms={rooms}
        conversations={railConversations}
        currentUserId={currentUserId}
        currentUserStatus={liveStatus}
        unreadHub={unreadHub}
        txtUnread={txtUnread}
        inboxUnread={inboxUnread}
      />
    )}
    {showMenu && (
      <HubMenuPanel
        permissions={permissions}
        showAdmin={showAdminRail}
        railItems={liveLayout.items}
        openCatalogIds={tabsApi.tabs.map(t => tabRail(t))}
        onOpen={(id, href, newCopy) => openApp(id, href, newCopy)}
        onSearch={() => { setShowMenu(false); openSearch() }}
        onEditRail={() => { setShowMenu(false); setShowLayoutEditor(true) }}
        onClose={() => setShowMenu(false)}
      />
    )}
    {phonePopup && (
      <PhonePopover
        open={phone.open}
        number={phone.number}
        conversationId={phone.conversationId}
        contactId={phone.contactId}
        nonce={phone.nonce}
        onClose={() => setPhone(p => ({ ...p, open: false }))}
        onOpenDialer={() => { setPhone(p => ({ ...p, open: false })); router.push('/hub/dialer') }}
      />
    )}
    {showLayoutEditor && (
      <LayoutEditor
        layout={liveLayout}
        permissions={permissions}
        rooms={rooms}
        conversations={railConversations}
        currentUserId={currentUserId}
        onChange={saveLayout}
        onClose={() => setShowLayoutEditor(false)}
      />
    )}
    <HubActivityPanel open={showActivity} onClose={() => setShowActivity(false)} />
    </>
  )

  // OnCallPresenceProvider wraps the shell so the purple "on a call" dot works
  // for everyone: dialer users (mounted inside DialerProvider, so it reads the
  // shared call state and tracks themselves) AND non-dialer users (no device —
  // they only observe teammates' dots).
  const withPresence = (
    <OnCallPresenceProvider companyId={companyId} currentUserId={currentUserId}>
      <HubActivityPinger />
      {shell}
    </OnCallPresenceProvider>
  )

  // Lift the Twilio Voice Device + IncomingCall overlay to shell level when
  // the user has dialer access AND hasn't opted out via Settings. Anyone else
  // gets the original Session 56 behavior: Device only registers when
  // DialerPanel mounts on /hub/dialer.
  const withDialer = liftDialerDevice ? <DialerProvider>{withPresence}</DialerProvider> : withPresence

  // ConversationPopoutProvider owns the floating message-thread window (txt / DM
  // / room) for everyone — like the dialer PiP, but for text. Wrapped outermost
  // so the pop-out survives navigation across every Hub page.
  // BetaFlagsProvider exposes the resolved beta flag map to every client
  // component under the shell (useBetaFlag('<key>')), so future Beta-ring entry
  // points can stay dark until the user opts in.
  return (
    <BetaFlagsProvider flags={betaFlags}>
      <WorkspaceTabsProvider api={tabsApi}>
        <ConversationPopoutProvider>{withDialer}</ConversationPopoutProvider>
      </WorkspaceTabsProvider>
    </BetaFlagsProvider>
  )
}
