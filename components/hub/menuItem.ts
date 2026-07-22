// Shared app-menu-item resolver (audit NAV-menuItem). The token -> {label, accent}
// mapping was copy-pasted across HubRail, HubMobileBar, AppLauncherPanel, and
// HubMobileMore and drifted (e.g. "Dialer" vs "Phone", different DND label
// wording, missing-token handling). This is the single source for that DATA;
// each surface keeps its own layout/markup but reads label + accent from here.
//
// classifyToken lives in lib/hub-layout; the catalog (canonical labels/icons)
// in railCatalog.
import { classifyToken } from '@/lib/hub-layout'
import { catalogById, type RailPermissions } from './railCatalog'

export type MenuRoom = { id: string; name: string; is_private?: boolean }
export type MenuConversation = {
  id: string
  participants: { id: string; display_name: string; avatar_url?: string | null }[]
}

export type MenuContext = {
  rooms: MenuRoom[]
  conversations: MenuConversation[]
  currentUserId?: string
  permissions: RailPermissions
  masterDndOn?: boolean
  hubDndOn?: boolean
  dialerDndOn?: boolean
}

// Per-app accent colors (launcher tiles / accents). Presentational only.
export const MENU_ACCENT: Record<string, string> = {
  hub: '#38bdf8', txt: '#2dd4bf', txt2: '#60a5fa', dialer: '#34d399', 'time-clock': '#fbbf24',
  'daily-log': '#fb923c', 'daily-log-v2': '#fb923c', routing: '#818cf8', reports: '#a78bfa',
  fleet: '#22d3ee', tracker: '#f472b6', books: '#10b981', marketing: '#fb7185', files: '#38bdf8',
  contacts: '#7dd3fc', forms: '#a3e635', 'pesticide-records': '#34d399', 'call-log': '#c084fc',
  'company-news': '#f59e0b', 'zone-sizer': '#2dd4bf',
  lawn: '#a3e635', 'time-records': '#fbbf24', 'email-inbox': '#818cf8',
}

/** The accent color for a token (DND tiers, url/room/dm, or a catalog app). */
export function resolveMenuAccent(token: string): string {
  const c = classifyToken(token)
  if (c.kind === 'master-dnd') return '#f87171'
  if (c.kind === 'hub-dnd') return '#fb923c'
  if (c.kind === 'dialer-dnd') return '#fb923c'
  if (c.kind === 'url') return '#7dd3fc'
  if (c.kind === 'room') return '#818cf8'
  if (c.kind === 'dm') return '#34d399'
  return MENU_ACCENT[c.id] ?? '#38bdf8'
}

/** Comma-joined first names of the OTHER participants in a DM. */
export function convFirstNames(conv: MenuConversation, currentUserId?: string): string {
  const others = conv.participants.filter(p => p.id !== currentUserId)
  if (others.length === 0) return conv.participants[0]?.display_name ?? 'You'
  return others.map(p => (p.display_name || '?').split(' ')[0]).join(', ')
}

/**
 * The canonical display label for a token. Returns null when the referenced
 * room/dm/catalog entry can't be resolved (caller should skip rendering it).
 * DND tiers reflect on/off state from ctx.
 */
export function resolveMenuLabel(token: string, ctx: MenuContext): string | null {
  const c = classifyToken(token)
  if (c.kind === 'master-dnd') return ctx.masterDndOn ? 'DND on' : 'DND'
  if (c.kind === 'hub-dnd') return ctx.hubDndOn ? 'Msg DND on' : 'Msg DND'
  if (c.kind === 'dialer-dnd') return ctx.dialerDndOn ? 'Call DND on' : 'Call DND'
  if (c.kind === 'url') {
    try { return new URL(c.href).hostname.replace(/^www\./, '') } catch { return c.href }
  }
  if (c.kind === 'room') return ctx.rooms.find(r => r.id === c.id)?.name ?? null
  if (c.kind === 'dm') {
    const conv = ctx.conversations.find(cv => cv.id === c.id)
    return conv ? convFirstNames(conv, ctx.currentUserId) : null
  }
  const id = c.id
  if (id === 'hub') return 'Hub'
  if (id === 'time-clock') return 'Clock'
  return catalogById(id, ctx.permissions)?.label ?? null
}
