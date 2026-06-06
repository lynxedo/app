/* Customizable Hub launcher — the single source of truth for the user's app
 * menu. ONE ordered list of "tokens" powers everything:
 *   - the desktop rail  = the list rendered vertically (shows many, scrolls)
 *   - the mobile dock    = the first MOBILE_VISIBLE items + a fixed Apps button
 *   - the app drawer     = the full list (this is where you add/hide/reorder)
 *   - the sidebar Favorites = the room/DM/tool items in the same list
 *
 * The rail/dock are literally the top of the drawer list — there's no separate
 * "rail config" vs "favorites" vs "drawer." Add anything, hide anything,
 * rearrange; the rail shows more than the mobile dock, that's the only diff.
 *
 * A token is one of:
 *   - a CatalogId  ('routing', 'fleet', 'daily-log', 'tools', 'links', and the
 *     system items 'hub' | 'txt' | 'time-clock' | 'txt2' | 'dialer')
 *   - 'sys:dnd'        — Do Not Disturb quick-toggle (flips your status)
 *   - 'url:<href>'     — a custom external link
 *   - 'room:<uuid>'    — jump to a Hub room
 *   - 'dm:<uuid>'      — jump to a DM / group conversation
 *
 * Pure + framework-free so it runs identically server-side (layout.tsx) and
 * client-side (the editor / sidebar).
 */

import { catalogById, type CatalogId, type RailPermissions } from '@/components/hub/railCatalog'

export type HubLayout = {
  version: 3
  items: string[]
}

// How many list items the mobile bottom bar shows before the Apps button.
export const MOBILE_VISIBLE = 5

// Brand-new user default (no legacy config, no pins). Permission filtering drops
// anything they can't access (e.g. dialer).
export const DEFAULT_ITEMS: string[] = ['hub', 'txt', 'dialer', 'time-clock', 'daily-log', 'tools']

const SYSTEM_CATALOG_IDS = new Set<CatalogId>(['hub', 'txt', 'time-clock'])
const ALWAYS_ALLOWED = new Set<CatalogId>(['hub', 'txt', 'time-clock', 'tools', 'links'])

export type Classified =
  | { kind: 'dnd' }
  | { kind: 'url'; href: string }
  | { kind: 'room'; id: string }
  | { kind: 'dm'; id: string }
  | { kind: 'catalog'; id: CatalogId }

export function classifyToken(token: string): Classified {
  if (token === 'sys:dnd') return { kind: 'dnd' }
  if (token.startsWith('url:')) return { kind: 'url', href: token.slice(4) }
  if (token.startsWith('room:')) return { kind: 'room', id: token.slice(5) }
  if (token.startsWith('dm:')) return { kind: 'dm', id: token.slice(3) }
  return { kind: 'catalog', id: token as CatalogId }
}

// Whether a token is allowed for these permissions. Catalog apps are gated by
// the CATALOG `requires` field via catalogById; everything else is open.
export function tokenAllowed(token: string, perms: RailPermissions): boolean {
  const c = classifyToken(token)
  if (c.kind !== 'catalog') return true
  const id = c.id
  if (id === ('activity' as CatalogId)) return false // Activity is the floating bell, never a list icon
  if (ALWAYS_ALLOWED.has(id) || SYSTEM_CATALOG_IDS.has(id)) return true
  return catalogById(id, perms) !== null
}

// Add a token if missing, remove it if present. Returns a new array.
export function toggleItem(items: string[], token: string): string[] {
  return items.includes(token) ? items.filter(t => t !== token) : [...items, token]
}

// Convert a sidebar "pin id" (bare room/conv uuid, or 'tool:x') to a list token.
// `isRoom` disambiguates a bare uuid (the sidebar knows from its rooms list).
export function pinIdToToken(id: string, isRoom: boolean): string {
  if (id.startsWith('tool:')) return id.slice(5) // 'tool:routing' → 'routing'
  return isRoom ? `room:${id}` : `dm:${id}`
}

// Strip junk, drop disallowed/duplicate tokens, keep order. Reads a v3 `items`
// list, or merges a legacy v2 `{ desktop, mobile }` layout into one list.
export function normalizeLayout(raw: unknown, perms: RailPermissions): HubLayout {
  const safe = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  let rawItems: unknown[] = []
  if (Array.isArray(safe.items)) {
    rawItems = safe.items
  } else if (Array.isArray(safe.desktop) || Array.isArray(safe.mobile)) {
    // v2 → v3: merge the two old lists (desktop order first).
    rawItems = [...(Array.isArray(safe.desktop) ? safe.desktop : []), ...(Array.isArray(safe.mobile) ? safe.mobile : [])]
  }
  const seen = new Set<string>()
  const items: string[] = []
  for (const v of rawItems) {
    if (typeof v !== 'string' || !v) continue
    if (seen.has(v)) continue
    if (!tokenAllowed(v, perms)) continue
    seen.add(v)
    items.push(v)
  }
  return { version: 3, items }
}

type LegacyRailConfig = { desktop?: (string | null)[]; mobile?: (string | null)[] } | null | undefined

// Reproduce a user's CURRENT rail (so the cutover is invisible) and merge in
// their pinned tools. Pinned rooms/DMs are reconciled client-side (the sidebar
// can classify bare uuids; the server can't without an extra query).
export function migrateLegacyLayout(
  railConfig: LegacyRailConfig,
  pinnedIds: string[] | null | undefined,
  perms: RailPermissions,
): HubLayout {
  const rc = railConfig ?? {}
  const pins = Array.isArray(pinnedIds) ? pinnedIds : []
  const toolPins = pins.filter(id => id.startsWith('tool:')).map(id => id.slice(5))

  const items: string[] = ['time-clock', 'hub', 'txt']
  if (perms.canAccessTxt) items.push('txt2')
  if (perms.canAccessDialer) items.push('dialer')
  for (const v of rc.desktop ?? []) if (v && v !== 'activity') items.push(v)
  for (const v of rc.mobile ?? []) if (v && v !== 'activity') items.push(v)
  for (const t of toolPins) items.push(t)

  return normalizeLayout({ version: 3, items }, perms)
}

// The one entry point: stored layout wins; else migrate legacy; else defaults.
export function resolveLayout(
  hubLayout: unknown,
  legacyRailConfig: LegacyRailConfig,
  legacyPinnedIds: string[] | null | undefined,
  perms: RailPermissions,
): HubLayout {
  if (
    hubLayout && typeof hubLayout === 'object' &&
    (Array.isArray((hubLayout as { items?: unknown }).items) ||
      Array.isArray((hubLayout as { desktop?: unknown }).desktop))
  ) {
    return normalizeLayout(hubLayout, perms)
  }
  const hasLegacy =
    (!!legacyRailConfig && (Array.isArray(legacyRailConfig.desktop) || Array.isArray(legacyRailConfig.mobile))) ||
    (Array.isArray(legacyPinnedIds) && legacyPinnedIds.length > 0)
  if (hasLegacy) return migrateLegacyLayout(legacyRailConfig, legacyPinnedIds, perms)
  return normalizeLayout({ version: 3, items: DEFAULT_ITEMS }, perms)
}

// Validate a layout object coming in over the API (PUT /api/profile).
export function isValidLayoutShape(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const okArr = (a: unknown) => Array.isArray(a) && a.every(x => typeof x === 'string')
  if (okArr(o.items)) return true
  // tolerate a legacy v2 shape so an older client can't 400
  return okArr(o.desktop) && okArr(o.mobile)
}
