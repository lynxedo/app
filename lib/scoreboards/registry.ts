/* Central registry of Scoreboards (KPI dashboards). Adding a new board = add an
 * entry here + a view component + a case in app/hub/scoreboards/[slug]/page.tsx.
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
    slug: '1',
    title: 'Main Scoreboard',
    subtitle: 'Visit revenue, sales, lead sources, retention & close rate',
    badge: 'Main',
  },
  {
    slug: '2',
    title: 'WF Weed & Fert',
    subtitle: 'Lawn-care jobs, add-ons, program mix & technician performance',
    badge: 'WF',
  },
  {
    slug: '3',
    title: 'IR Irrigation',
    subtitle: 'Gold book, repair tickets, revenue by tech & Rachio / Gold plans sold',
    badge: 'IR',
  },
  {
    slug: '4',
    title: 'PW Pet Waste',
    subtitle: 'Active customers, annual value, visit revenue & technician performance',
    badge: 'PW',
  },
  {
    slug: '5',
    title: 'Office',
    subtitle: 'Lead sources, closes per week, close rates & sales — from the Lead Tracker',
    badge: 'Office',
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
  if (perms.isAdmin) return true
  if (!perms.canAccessScoreboards) return false
  return (perms.allowedBoardSlugs ?? []).includes(slug)
}

/** The boards a given user is allowed to see. */
export function boardsForUser(perms: ScoreboardPerms): ScoreboardMeta[] {
  if (perms.isAdmin) return SCOREBOARDS
  if (!perms.canAccessScoreboards) return []
  const allowed = new Set(perms.allowedBoardSlugs ?? [])
  return SCOREBOARDS.filter(b => allowed.has(b.slug))
}

export function getScoreboard(slug: string): ScoreboardMeta | null {
  return SCOREBOARDS.find(b => b.slug === slug) ?? null
}
