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
 *     system items 'hub' | 'time-clock' | 'txt2' | 'dialer')
 *   - 'sys:dnd'        — Master DND quick-toggle (silences everything)
 *   - 'sys:hub-dnd'    — Hub notifications DND quick-toggle
 *   - 'sys:dialer-dnd' — Dialer calls DND quick-toggle
 *   - 'url:<href>'     — a custom external link
 *   - 'room:<uuid>'    — jump to a Hub room
 *   - 'dm:<uuid>'      — jump to a DM / group conversation
 *
 * Pure + framework-free so it runs identically server-side (layout.tsx) and
 * client-side (the editor / sidebar).
 */

import { CATALOG, catalogById, type CatalogId, type RailPermissions } from '@/components/hub/railCatalog'

export type HubLayout = {
  version: 3
  items: string[]
}

// How many list items the mobile bottom bar shows before the Apps button.
export const MOBILE_VISIBLE = 5

// Brand-new user default (no legacy config, no pins). Permission filtering drops
// anything they can't access (e.g. dialer).
export const DEFAULT_ITEMS: string[] = ['hub', 'txt2', 'dialer', 'time-clock', 'daily-log', 'tools']

// Catalog ids that are real navigable PAGES (have an href). These are the only
// tokens auto-seeded into a user's drawer (see reconcileSeededApps). Container
// items ('tools', 'links'), the floating bell ('activity'), and non-catalog
// tokens (url:/room:/dm:) are intentionally excluded — links, DMs, and rooms are
// never auto-added. Derived from CATALOG so new pages are covered automatically.
export const PAGE_CATALOG_IDS: CatalogId[] = CATALOG.filter(e => !!e.href).map(e => e.id)

// These items are LOCKED to the front of every user's menu (rail + mobile bar)
// and can't be removed or reordered in the customizer. Permission-filtered: if a
// user can't access one (e.g. no Dialer access), it's simply skipped and their
// own customized items slide up to fill the space. Everything after these is
// fully customizable.
export const LOCKED_PREFIX: string[] = ['hub', 'txt2', 'dialer', 'time-clock']

// Force the allowed locked items to the front (canonical order), with the user's
// remaining custom items after. Removes any locked ids from the tail so they
// can't be duplicated or dragged out of place.
export function applyLockedPrefix(items: string[], perms: RailPermissions): string[] {
  const locked = LOCKED_PREFIX.filter(t => tokenAllowed(t, perms))
  const lockedSet = new Set(locked)
  const rest = items.filter(t => !lockedSet.has(t))
  return [...locked, ...rest]
}

// How many of a (normalized) list's leading items are locked — i.e. the count
// the customizer should render as non-editable. Locked items are always a
// contiguous prefix after normalizeLayout.
export function lockedCount(items: string[]): number {
  const lockedSet = new Set(LOCKED_PREFIX)
  let n = 0
  for (const t of items) { if (lockedSet.has(t)) n++; else break }
  return n
}

const SYSTEM_CATALOG_IDS = new Set<CatalogId>(['hub', 'time-clock'])
const ALWAYS_ALLOWED = new Set<CatalogId>(['hub', 'time-clock', 'tools', 'links'])

export type Classified =
  | { kind: 'master-dnd' }
  | { kind: 'hub-dnd' }
  | { kind: 'dialer-dnd' }
  | { kind: 'url'; href: string }
  | { kind: 'room'; id: string }
  | { kind: 'dm'; id: string }
  | { kind: 'catalog'; id: CatalogId }

export function classifyToken(token: string): Classified {
  if (token === 'sys:dnd') return { kind: 'master-dnd' }
  if (token === 'sys:hub-dnd') return { kind: 'hub-dnd' }
  if (token === 'sys:dialer-dnd') return { kind: 'dialer-dnd' }
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
  return { version: 3, items: applyLockedPrefix(items, perms) }
}

export type SeedReconcile = {
  items: string[]          // the (possibly expanded) layout item list
  seeded: CatalogId[]      // the seeded-set to persist (= currently-accessible pages)
  itemsChanged: boolean    // whether `items` gained any auto-added pages
  changed: boolean         // whether anything needs persisting (items and/or seeded)
}

// Auto-seed every PAGE the user can access that hasn't been offered to them yet,
// appending it to the end of their drawer. Removal-safe: a page the user deleted
// stays in `seeded` (so we never re-add it) while being absent from `items`.
//
// The seeded-set is kept equal to the user's currently-accessible pages, which
// gives the right behavior on every transition with no extra bookkeeping:
//   - new user / existing user first run → seeded empty → all accessible pages added
//   - admin GRANTS a page later          → not yet in seeded → added on next load
//   - admin REVOKES a page               → drops from accessible (and from seeded);
//                                           normalizeLayout already strips it from items
//   - admin RE-GRANTS                     → not in seeded again → re-added
//   - user removes a page                 → still accessible AND seeded → never re-added
//
// Only catalog pages (PAGE_CATALOG_IDS) are ever touched — url:/room:/dm: tokens
// and the tools/links containers pass through untouched.
export function reconcileSeededApps(
  currentItems: string[],
  prevSeeded: string[] | null | undefined,
  perms: RailPermissions,
): SeedReconcile {
  const accessible = PAGE_CATALOG_IDS.filter(id => tokenAllowed(id, perms))
  const seededSet = new Set(prevSeeded ?? [])
  const present = new Set(currentItems)
  const toAdd = accessible.filter(id => !seededSet.has(id) && !present.has(id))

  // seeded should end up exactly equal to `accessible`; detect if it isn't yet.
  const seededChanged =
    seededSet.size !== accessible.length || accessible.some(id => !seededSet.has(id))

  if (toAdd.length === 0 && !seededChanged) {
    return { items: currentItems, seeded: accessible, itemsChanged: false, changed: false }
  }
  const items = toAdd.length
    ? normalizeLayout({ version: 3, items: [...currentItems, ...toAdd] }, perms).items
    : currentItems
  return { items, seeded: accessible, itemsChanged: toAdd.length > 0, changed: true }
}

type LegacyRailConfig = { desktop?: (string | null)[]; mobile?: (string | null)[] } | null | undefined

// Reproduce a user's CURRENT rail (so the cutover is invisible). The launcher
// (hub_layout) is intentionally SEPARATE from the sidebar Hub Favorites
// (hub_pinned_ids), so pinned rooms/DMs/tools are NOT pulled in here.
export function migrateLegacyLayout(
  railConfig: LegacyRailConfig,
  _pinnedIds: string[] | null | undefined,
  perms: RailPermissions,
): HubLayout {
  const rc = railConfig ?? {}

  const items: string[] = ['time-clock', 'hub']
  if (perms.canAccessTxt) items.push('txt2')
  if (perms.canAccessDialer) items.push('dialer')
  for (const v of rc.desktop ?? []) if (v && v !== 'activity') items.push(v)
  for (const v of rc.mobile ?? []) if (v && v !== 'activity') items.push(v)

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
