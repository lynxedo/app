/* Central registry of Scoreboards (KPI dashboards). Adding a new board = add an
 * entry here + a view component + a case in app/hub/scoreboards/[slug]/page.tsx.
 *
 * Per-board access: V1 gates the whole section behind the single
 * `can_access_scoreboards` flag. `requiredFlag` is the seam for the future
 * "certain workers see certain boards" feature — when a per-board permission
 * model lands, set it here and filter on it in the index + the [slug] gate. */

export type ScoreboardPerms = {
  isAdmin: boolean
  canAccessScoreboards: boolean
}

export type ScoreboardMeta = {
  slug: string
  title: string
  subtitle: string
  badge?: string
  /** Future per-board gate. Unset = visible to anyone who can see the section. */
  requiredFlag?: keyof ScoreboardPerms
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
]

/** Whether a user can see the Scoreboards section at all. */
export function canSeeScoreboards(perms: ScoreboardPerms): boolean {
  return perms.isAdmin || perms.canAccessScoreboards
}

/** The boards a given user is allowed to see. */
export function boardsForUser(perms: ScoreboardPerms): ScoreboardMeta[] {
  if (!canSeeScoreboards(perms)) return []
  return SCOREBOARDS.filter(b => !b.requiredFlag || perms[b.requiredFlag])
}

export function getScoreboard(slug: string): ScoreboardMeta | null {
  return SCOREBOARDS.find(b => b.slug === slug) ?? null
}
