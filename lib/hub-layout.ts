/* Customizable Hub launcher — the single source of truth for what icons appear
 * on the desktop rail and the mobile bottom bar, in what order.
 *
 * A layout is two ordered lists of string "tokens" (desktop + mobile). Each
 * token is one of:
 *   - a CatalogId  ('routing', 'fleet', 'daily-log', 'tools', 'links', …) — an
 *     app/tool. 'hub' | 'txt' | 'time-clock' are CatalogIds too (system items
 *     with bespoke click behavior); 'txt2'/'dialer' are permission-gated apps.
 *   - 'sys:dnd'        — Do Not Disturb quick-toggle (flips your status)
 *   - 'url:<href>'     — a custom external link
 *   - 'room:<uuid>'    — jump straight to a Hub room
 *   - 'dm:<uuid>'      — jump straight to a DM (reserved; rendered in the
 *                        sidebar today, on the rail in a later phase)
 *
 * Anything NOT in a list is simply hidden. Order in the list = order on screen.
 * Two separate lists mean a lean phone and a loaded desktop can coexist on one
 * account (Ben's call). This module is pure + framework-free so it can run
 * server-side (layout.tsx) and client-side (the editor) identically.
 */

import { catalogById, type CatalogId, type RailPermissions } from '@/components/hub/railCatalog'

export type HubLayout = {
  version: 2
  desktop: string[]
  mobile: string[]
}

// What a brand-new user (no legacy config, no pins) starts with. Existing users
// are migrated from their current rail instead (see migrateLegacyLayout).
// Permission filtering drops anything the user can't access (e.g. dialer).
export const DEFAULT_DESKTOP_LAYOUT: string[] = ['hub', 'txt', 'dialer', 'time-clock', 'daily-log', 'tools']
export const DEFAULT_MOBILE_LAYOUT: string[] = ['hub', 'txt', 'dialer', 'time-clock']

// CatalogIds that are "system" items — present in the rail with bespoke click
// behavior but NOT in the pickable CATALOG list (so catalogById returns null).
const SYSTEM_CATALOG_IDS = new Set<CatalogId>(['hub', 'txt', 'time-clock'])
// CatalogIds that are always allowed regardless of permissions.
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
  if (id === ('activity' as CatalogId)) return false // Activity is the floating bell, never a rail icon
  if (ALWAYS_ALLOWED.has(id) || SYSTEM_CATALOG_IDS.has(id)) return true
  return catalogById(id, perms) !== null
}

// Strip junk, drop disallowed/duplicate tokens, keep order. Used on every read
// so a layout written before a permission was revoked self-heals at render.
export function normalizeLayout(raw: unknown, perms: RailPermissions): HubLayout {
  const safe = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const clean = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const v of arr) {
      if (typeof v !== 'string' || !v) continue
      if (seen.has(v)) continue
      if (!tokenAllowed(v, perms)) continue
      seen.add(v)
      out.push(v)
    }
    return out
  }
  return { version: 2, desktop: clean(safe.desktop), mobile: clean(safe.mobile) }
}

type LegacyRailConfig = { desktop?: (string | null)[]; mobile?: (string | null)[] } | null | undefined

// Reproduce a user's CURRENT rail (so the cutover is invisible), then merge in
// their pinned tools so Favorites and the rail become one list (Ben's "merge").
export function migrateLegacyLayout(
  railConfig: LegacyRailConfig,
  pinnedIds: string[] | null | undefined,
  perms: RailPermissions,
): HubLayout {
  const rc = railConfig ?? {}
  const pins = Array.isArray(pinnedIds) ? pinnedIds : []
  // 'tool:routing' → 'routing' (TOOL_CATALOG ids map 1:1 onto CatalogIds).
  const toolPins = pins.filter((id) => id.startsWith('tool:')).map((id) => id.slice(5))

  // Desktop: the fixed primary order today is Clock, Hub, Txt, [Txt2], [Dialer],
  // then the 4 picker slots — then their pinned tools appended.
  const desktop: string[] = ['time-clock', 'hub', 'txt']
  if (perms.canAccessTxt) desktop.push('txt2')
  if (perms.canAccessDialer) desktop.push('dialer')
  for (const v of rc.desktop ?? []) if (v && v !== 'activity') desktop.push(v)
  for (const t of toolPins) desktop.push(t)

  // Mobile: today's fixed bar is Hub, Txt, [Phone], Clock, then the 1 user slot.
  const mobile: string[] = ['hub', 'txt']
  if (perms.canAccessDialer) mobile.push('dialer')
  mobile.push('time-clock')
  for (const v of rc.mobile ?? []) if (v && v !== 'activity') mobile.push(v)

  return normalizeLayout({ version: 2, desktop, mobile }, perms)
}

// The one entry point: given the stored hub_layout plus the legacy columns,
// return the layout to render. Stored layout wins; otherwise migrate; otherwise
// brand-new defaults.
export function resolveLayout(
  hubLayout: unknown,
  legacyRailConfig: LegacyRailConfig,
  legacyPinnedIds: string[] | null | undefined,
  perms: RailPermissions,
): HubLayout {
  if (hubLayout && typeof hubLayout === 'object' && Array.isArray((hubLayout as { desktop?: unknown }).desktop)) {
    return normalizeLayout(hubLayout, perms)
  }
  const hasLegacy =
    (!!legacyRailConfig && (Array.isArray(legacyRailConfig.desktop) || Array.isArray(legacyRailConfig.mobile))) ||
    (Array.isArray(legacyPinnedIds) && legacyPinnedIds.length > 0)
  if (hasLegacy) return migrateLegacyLayout(legacyRailConfig, legacyPinnedIds, perms)
  return normalizeLayout({ version: 2, desktop: DEFAULT_DESKTOP_LAYOUT, mobile: DEFAULT_MOBILE_LAYOUT }, perms)
}

// Validate a layout object coming in over the API (PUT /api/profile).
export function isValidLayoutShape(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const okArr = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string')
  return okArr(o.desktop) && okArr(o.mobile)
}
