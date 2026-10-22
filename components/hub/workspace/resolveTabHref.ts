// Workspace Tabs — what does an href open as?
//
// Screens with a kept-alive twin component (rooms, DMs, Boards, Txt/Inbox
// threads, Contacts, Tracker, Routing, Pricer, Scoreboards, Work Orders) open as
// that twin, exactly as the rail and sidebars have always opened them — so the
// same conversation never ends up open twice, once as a twin and once as a page.
// Everything else opens as a PAGE tab (the real route). Window-only screens
// (Dialer, Radio — see isWindowOnlyPath) are never framed: they navigate the
// window, whose route the shell then binds to a tab.

import { appKeyFromPath, isUuid, isWindowOnlyPath } from '@/lib/hub-embed'
import { CATALOG, type CatalogId, type RailPermissions } from '../railCatalog'
import { convFirstNames, type MenuConversation, type MenuRoom } from '../menuItem'
import type { OpenTabInput, TabCatalogId } from './WorkspaceTabsContext'

export type ResolveContext = {
  rooms: MenuRoom[]
  conversations: MenuConversation[]
  currentUserId?: string
  permissions: RailPermissions
}

export type ResolvedHref =
  | { action: 'tab'; input: OpenTabInput }
  | { action: 'window'; href: string }

/** Labels for page tabs that aren't a catalog app's own root. */
const PAGE_LABELS: Array<[string, string, TabCatalogId]> = [
  ['/hub/admin/timesheet', 'Time Records', 'time-records'],
  ['/hub/admin', 'Admin', 'admin'],
  ['/hub/settings', 'Settings', 'settings'],
  ['/hub/my-tasks', 'My Tasks', 'page'],
  ['/hub/activity', 'Activity', 'activity'],
  ['/hub/amber', 'Amber', 'page'],
  ['/hub/home', 'Home', 'page'],
  ['/hub/quotes/new', 'New quote', 'quotes'],
  ['/hub/contacts/', 'Customer', 'contacts'],
  ['/hub/txt/broadcasts', 'Broadcasts', 'txt2'],
  ['/hub/txt/contacts', 'Txt contacts', 'txt2'],
  ['/hub/call-log2', 'Call Log', 'call-log'],
  ['/hub/billing', 'Billing', 'page'],
]

/** The catalog app a Hub path belongs to (longest href prefix wins), or null. */
export function catalogForPath(pathname: string): { id: CatalogId; label: string } | null {
  const p = pathname.split('?')[0]
  let best: { id: CatalogId; label: string; len: number } | null = null
  for (const e of CATALOG) {
    if (!e.href) continue
    if (p === e.href || p.startsWith(e.href + '/')) {
      if (!best || e.href.length > best.len) best = { id: e.id, label: e.label, len: e.href.length }
    }
  }
  return best ? { id: best.id, label: best.label } : null
}

/** A page tab's catalogId + label for a path. */
export function pageTabMeta(href: string): { catalogId: TabCatalogId; label: string } {
  const p = href.split('?')[0]
  for (const [prefix, label, catalogId] of PAGE_LABELS) {
    if (prefix.endsWith('/') ? p.startsWith(prefix) : (p === prefix || p.startsWith(prefix + '/'))) {
      return { catalogId, label }
    }
  }
  const cat = catalogForPath(p)
  if (cat) return { catalogId: cat.id, label: cat.label }
  return { catalogId: 'page', label: 'Hub' }
}

function lastChatRoute(): string | null {
  try {
    const last = localStorage.getItem('hub_last_chat_route')
    if (last && last.startsWith('/hub/') && last !== '/hub/home') return last
  } catch { /* ignore */ }
  return null
}

export function resolveTabHref(href: string, ctx: ResolveContext): ResolvedHref | null {
  if (!href.startsWith('/hub')) return null
  const [path] = href.split('?')
  const seg = path.split('/').filter(Boolean) // ['hub', ...]

  if (isWindowOnlyPath(path)) return { action: 'window', href }

  // /hub itself is "back to the chat you were in".
  if (seg.length === 1) {
    const last = lastChatRoute()
    if (last && last !== '/hub') return resolveTabHref(last, ctx)
    const general = ctx.rooms.find(r => r.name === 'general') ?? ctx.rooms[0]
    if (general) return resolveTabHref(`/hub/${general.id}`, ctx)
    return { action: 'tab', input: { catalogId: 'hub', label: 'Hub', href, kind: 'page' } }
  }

  const first = seg[1]
  const second = seg[2]

  // Conversations and boards.
  if (seg.length === 2 && isUuid(first)) {
    const room = ctx.rooms.find(r => r.id === first)
    if (room) return { action: 'tab', input: { catalogId: 'room', instanceKey: room.id, label: room.name, href: path } }
  }
  if (first === 'pm' && second && seg.length === 3) {
    const conv = ctx.conversations.find(c => c.id === second)
    const label = conv ? convFirstNames(conv, ctx.currentUserId) : 'Message'
    return { action: 'tab', input: { catalogId: 'dm', instanceKey: second, label, href: path } }
  }
  if (first === 'board' && second && seg.length === 3) {
    return { action: 'tab', input: { catalogId: 'board', instanceKey: second, label: 'Board', href: path } }
  }
  if (first === 'txt' && isUuid(second) && seg.length === 3 && ctx.permissions.canAccessTxt) {
    return { action: 'tab', input: { catalogId: 'txt-thread', instanceKey: second, label: 'Txt', href: path } }
  }
  if (first === 'email' && isUuid(second) && seg.length === 3 && ctx.permissions.canAccessSharedInbox) {
    return { action: 'tab', input: { catalogId: 'inbox-thread', instanceKey: second, label: 'Email', href: path } }
  }

  // Apps with a twin, at their own root.
  const exact = path.replace(/\/$/, '')
  const p = ctx.permissions
  if (exact === '/hub/contacts' && p.canAccessHub) return { action: 'tab', input: { catalogId: 'contacts', label: 'Contacts', href: '/hub/contacts' } }
  if (exact === '/hub/pricer' && p.canAccessPricer) return { action: 'tab', input: { catalogId: 'pricer', label: 'Pricer', href: '/hub/pricer' } }
  if ((exact === '/hub/tracker' || exact === '/hub/tracker/leads') && p.canAccessTracker) return { action: 'tab', input: { catalogId: 'tracker', label: 'Tracker', href: '/hub/tracker' } }
  if (exact === '/hub/routing' && p.canAccessRouting) return { action: 'tab', input: { catalogId: 'routing', label: 'Routing', href: '/hub/routing' } }
  if (exact === '/hub/daily-log-v2' && p.canAccessDailyLogV2) return { action: 'tab', input: { catalogId: 'daily-log-v2', label: 'Work Orders', href: '/hub/daily-log-v2' } }
  if (first === 'scoreboards' && p.canAccessScoreboards) {
    if (seg.length === 2) return { action: 'tab', input: { catalogId: 'scoreboards', label: 'Scoreboards', href: '/hub/scoreboards' } }
    if (seg.length === 3) return { action: 'tab', input: { catalogId: 'scoreboards', instanceKey: second, label: 'Scoreboard', href: path } }
  }

  // Everything else: the real page.
  const meta = pageTabMeta(href)
  return { action: 'tab', input: { catalogId: meta.catalogId, label: meta.label, href, kind: 'page' } }
}

/** Same app? (Navigating within one app stays in its tab.) */
export function sameApp(a: string, b: string): boolean {
  return appKeyFromPath(a) === appKeyFromPath(b)
}
