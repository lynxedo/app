'use client'

/**
 * The Hub shell for a page running INSIDE a Workspace Tab (a page tab's frame —
 * see lib/hub-embed.ts and components/hub/workspace/PageTabFrame.tsx).
 *
 * The window already has the rail, top bar, tab strip, phone, radio, call bar
 * and notifiers, so this renders none of them: just the section's own sidebar
 * (Admin, Reports, Marketing, …) and the page. Everything that must exist once
 * per window is skipped on purpose — a second Twilio Device here would be a
 * second phone ringing (lesson_every_tab_is_another_phone).
 *
 * It keeps the tab inside its own app: moving within the app (Admin → People,
 * one report → another) stays here and is reported up so the tab's href follows;
 * anything that heads for a different app is handed to the window, which opens it
 * as its own tab, and this frame stays where it was.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { BetaFlagsProvider } from './BetaFlagsContext'
import ConversationPopoutProvider from './popout/ConversationPopoutProvider'
import OnCallPresenceProvider from './OnCallPresenceProvider'
import HubSectionSidebar, { SECTION_SIDEBAR_RAILS, resolveAdminGrants } from './HubSectionSidebar'
import { railFromPath } from './HubRail'
import { WorkspaceTabsProvider, DISABLED_TABS_API, type WorkspaceTabsApi } from './workspace/WorkspaceTabsContext'
import { WorkspaceTabInstanceProvider } from './workspace/WorkspaceTabInstance'
import { appKeyFromPath, cleanEmbedHref, EMBED_NAME_PREFIX, isLxMessage, type EmbedToShellMessage, type ShellToEmbedMessage } from '@/lib/hub-embed'
import { announceHubIntent } from '@/lib/hub-intent'
import type { HubShellProps } from './HubShell'

function postUp(msg: EmbedToShellMessage) {
  try { window.parent.postMessage(msg, window.location.origin) } catch { /* detached */ }
}

export default function EmbeddedHubShell(props: HubShellProps) {
  const pathname = usePathname() ?? ''
  const router = useRouter()

  // The app this tab belongs to is wherever it first loaded.
  const homeAppRef = useRef<string | null>(null)
  if (homeAppRef.current === null) homeAppRef.current = appKeyFromPath(pathname)
  const homeApp = homeAppRef.current
  const foreign = appKeyFromPath(pathname) !== homeApp
  const lastHomeHrefRef = useRef<string>(pathname)

  // Report every move; bounce a different app to the window.
  useEffect(() => {
    const href = cleanEmbedHref(pathname, window.location.search)
    if (foreign) {
      postUp({ lx: 'open', href })
      router.replace(lastHomeHrefRef.current)
      return
    }
    lastHomeHrefRef.current = href
    postUp({ lx: 'nav', href })
  }, [pathname, foreign, router])

  // Query-string moves (filters kept in the URL) don't change the pathname, so
  // follow history writes too.
  useEffect(() => {
    const report = () => {
      const href = cleanEmbedHref(window.location.pathname, window.location.search)
      if (appKeyFromPath(href) === homeApp) postUp({ lx: 'nav', href })
    }
    const origPush = window.history.pushState
    const origReplace = window.history.replaceState
    window.history.pushState = function (...args: Parameters<History['pushState']>) {
      const r = origPush.apply(this, args)
      report()
      return r
    }
    window.history.replaceState = function (...args: Parameters<History['replaceState']>) {
      const r = origReplace.apply(this, args)
      report()
      return r
    }
    window.addEventListener('popstate', report)
    return () => {
      window.history.pushState = origPush
      window.history.replaceState = origReplace
      window.removeEventListener('popstate', report)
    }
  }, [homeApp])

  // The tab's label follows the page's title when the page sets one.
  useEffect(() => {
    const send = () => { const t = document.title; if (t && t !== 'Hub') postUp({ lx: 'title', title: t }) }
    send()
    const el = document.querySelector('title')
    if (!el) return
    const mo = new MutationObserver(send)
    mo.observe(el, { childList: true, characterData: true, subtree: true })
    return () => mo.disconnect()
  }, [pathname])

  // Window → frame: am I on screen? / a New… request.
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return
      if (!isLxMessage(e.data)) return
      const m = e.data as ShellToEmbedMessage
      if (m.lx === 'visible') setVisible(m.visible)
      else if (m.lx === 'intent') announceHubIntent(m.kind)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Window shortcuts pressed while focus is in here (⌘K, Ctrl/⌘+1..9).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k !== 'k' && !/^[1-9]$/.test(k)) return
      e.preventDefault()
      e.stopPropagation()
      postUp({ lx: 'key', key: k, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // A link to a different app opens in the window as its own tab, without this
  // frame navigating away first (code-driven navigations are caught above).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      let url: URL
      try { url = new URL(a.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/hub')) return
      if (appKeyFromPath(url.pathname) === homeApp) return
      e.preventDefault()
      postUp({ lx: 'open', href: url.pathname + url.search })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [homeApp])

  // Screens that open things as tabs (the Txt / Inbox sidebars) ask the window.
  const tabsApi = useMemo<WorkspaceTabsApi>(() => {
    const forward = (input: Parameters<WorkspaceTabsApi['openTab']>[0]) => {
      postUp({ lx: 'openTab', input: { catalogId: input.catalogId, label: input.label, href: input.href, instanceKey: input.instanceKey, newCopy: input.newCopy } })
      return null
    }
    return { ...DISABLED_TABS_API, enabled: true, openTab: forward, openApp: forward }
  }, [])

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const rail = railFromPath(pathname)
  const showSidebar = SECTION_SIDEBAR_RAILS.has(rail)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('hub-sidebar-collapsed') === '1') } catch { /* ignore */ }
  }, [])
  const toggleCollapsed = () => setCollapsed(c => {
    const next = !c
    try { localStorage.setItem('hub-sidebar-collapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })
  const { grants } = resolveAdminGrants(props.adminGrants, !!props.isAdmin)

  const tabId = typeof window !== 'undefined' && window.name.startsWith(EMBED_NAME_PREFIX)
    ? window.name.slice(EMBED_NAME_PREFIX.length)
    : 'embedded'

  let body: ReactNode = props.children
  if (foreign) body = <div className="flex-1" />

  return (
    <BetaFlagsProvider flags={props.betaFlags ?? {}}>
      <WorkspaceTabsProvider api={tabsApi}>
        <ConversationPopoutProvider>
          <OnCallPresenceProvider companyId={props.companyId} currentUserId={props.currentUserId}>
            <div className="hub-root flex h-[100dvh] bg-gray-950 text-white overflow-hidden">
              {showSidebar && (
                <div
                  className={`relative flex-none overflow-hidden ${collapsed ? 'w-0' : 'w-72'}`}
                  aria-hidden={collapsed ? true : undefined}
                  inert={collapsed ? true : undefined}
                >
                  <HubSectionSidebar
                    rail={rail}
                    onClose={() => {}}
                    onDesktopCollapse={toggleCollapsed}
                    isAdmin={!!props.isAdmin}
                    isPlatformAdmin={props.isPlatformAdmin}
                    billingEnabled={props.billingEnabled}
                    grants={grants}
                    canAccessTxt={!!props.canAccessTxt}
                    canManageTxt={!!props.canManageTxt}
                    canAccessDialer={!!props.canAccessDialer}
                    canAccessUnifiedInbox={!!props.canAccessUnifiedInbox}
                    canAccessMarketing={!!props.canAccessMarketing}
                    canAccessEmail={!!props.canAccessEmail}
                    canManageDrip={!!props.canManageDrip}
                    canAdminMarketing={!!props.canAdminMarketing}
                    canAdminEmail={!!props.canAdminEmail}
                    canAccessBeta={!!props.canAccessBeta}
                    currentUserId={props.currentUserId}
                    companyId={props.companyId ?? ''}
                    scoreboardSlugs={props.scoreboardSlugs}
                    reportSlugs={props.reportSlugs}
                  />
                </div>
              )}
              {showSidebar && collapsed && (
                <button
                  onClick={toggleCollapsed}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-5 h-12 bg-[var(--t-sidebar)] hover:bg-[var(--t-sidebar-hover)] border-y border-r border-white/10 rounded-r text-white/80 hover:text-white transition-colors"
                  aria-label="Show sidebar"
                  title="Show sidebar"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              <div className="hub-main flex-1 flex flex-col min-w-0 overflow-hidden relative">
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                  <WorkspaceTabInstanceProvider tabId={tabId} isActive={visible}>
                    {body}
                  </WorkspaceTabInstanceProvider>
                </div>
              </div>
            </div>
          </OnCallPresenceProvider>
        </ConversationPopoutProvider>
      </WorkspaceTabsProvider>
    </BetaFlagsProvider>
  )
}
