/* Central registry of the SHIPPED Scoreboards (KPI dashboards).
 *
 * Retention & Churn is the only one left. Main, WF, IR, PW, Office and Lead
 * Sources were retired on Sep 3 2026 — everything they showed is available as
 * cards in the widget library, so the boards people actually use are the ones
 * they build (see CUSTOM_SLUG_PREFIX below).
 *
 * ⚠ Retention stays because it is the one board a date picker CANNOT replace.
 * It takes no window at all — `scoreboard_churn_summary` is asked for a YEAR —
 * so its weekly snapshots are the only way to see it in the past. And it needs
 * that: re-reading the six months that were already closed on Jul 11 2026 gives
 * four MORE cancellations today than the Jul 11 snapshot recorded (Feb 6→7,
 * May 7→8, Jun 14→16; 86% retention → 84.8%), because cancellations get entered
 * late. The snapshot is the record of what we believed and acted on that week;
 * re-running the numbers can only ever tell you what we believe now.
 *
 * Access model (two layers):
 *   1. Section gate — `can_access_scoreboards` (Admin -> People). Whether the user
 *      can open the Scoreboards section at all.
 *   2. Per-board view access — `scoreboard_board_access` rows (Admin -> Scoreboards).
 *      Which specific boards a non-admin user may open. Default is nothing-until-
 *      granted: a user with the section flag but no grants sees zero boards.
 *   Admins (role = 'admin') always see every board, regardless of grants. */

export type ScoreboardPerms = {
  isAdmin: boolean
  canAccessScoreboards: boolean
  /** Board slugs this user is explicitly granted. Ignored for admins (who see all). */
  allowedBoardSlugs?: string[]
}

export type ScoreboardMeta = {
  slug: string
  title: string
  subtitle: string
  badge?: string
}

export const SCOREBOARDS: ScoreboardMeta[] = [
  {
    slug: '7',
    title: 'Retention & Churn',
    subtitle: 'Recurring retention, churn by reason & type, monthly trend — this year',
    badge: 'Retention',
  },
]

/** Whether a user can see the Scoreboards section at all (i.e. has ≥1 visible board). */
export function canSeeScoreboards(perms: ScoreboardPerms): boolean {
  if (perms.isAdmin) return true
  if (!perms.canAccessScoreboards) return false
  return (perms.allowedBoardSlugs?.length ?? 0) > 0
}

/** Whether a user may open one specific board. */
export function canSeeBoard(perms: ScoreboardPerms, slug: string): boolean {
  // Call Coaching used to live here as board '6', gated on can_access_coaching
  // alone with no admin bypass. It moved to Reports (/hub/reports/coaching) and
  // kept that gate exactly — see `canSeeReport` in lib/reports/registry.ts. Do
  // not reintroduce a coaching case here.
  if (perms.isAdmin) return true
  if (!perms.canAccessScoreboards) return false
  return (perms.allowedBoardSlugs ?? []).includes(slug)
}

/** The boards a given user is allowed to see. */
export function boardsForUser(perms: ScoreboardPerms): ScoreboardMeta[] {
  return SCOREBOARDS.filter(b => canSeeBoard(perms, b.slug))
}

export function getScoreboard(slug: string): ScoreboardMeta | null {
  return SCOREBOARDS.find(b => b.slug === slug) ?? null
}

/* ── Custom (user-built) scoreboards ─────────────────────────────────────── */

/**
 * Slug namespace for a board somebody built, e.g. `custom-k3f9dq2m1x`.
 *
 * ⚠ A HYPHEN, not the colon that Reports use (`report:clients`). All three kinds
 * share `scoreboard_layouts.slug`, but only this one also appears in a URL path
 * (`/hub/scoreboards/custom-k3f9dq2m1x`) — a colon there is legal per RFC 3986 yet
 * gets percent-encoded by half the tooling that touches it, so the id would stop
 * matching the row. The prefix still can't collide with the shipped board slug or `report:`.
 */
export const CUSTOM_SLUG_PREFIX = 'custom-'

/** Client-safe: used by the page dispatch, the Workspace-Tabs twin and the sidebar. */
export function isCustomBoardSlug(slug: string): boolean {
  return slug.startsWith(CUSTOM_SLUG_PREFIX) && slug.length > CUSTOM_SLUG_PREFIX.length
}
