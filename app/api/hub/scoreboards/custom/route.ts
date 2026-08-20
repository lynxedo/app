import { NextResponse } from 'next/server'
import { cloneCustomBoard, createCustomBoard, listCustomBoards, resolveScoreboardCaller } from '@/lib/scoreboards/custom'

export const dynamic = 'force-dynamic'

/* User-built Scoreboards — list what you can open, and create a new one.
 *
 * GET  → { boards: CustomBoardSummary[] }
 * POST { title }                → { slug }                              a new empty board
 * POST { cloneFrom, title?, forEmployeeId? }
 *      → { slug, title, copied, skipped, repointed? }                a copy of one,
 *        with every person filter re-pointed at `forEmployeeId` where it can be —
 *        see lib/scoreboards/person-map.ts for what "can be" means and why two of
 *        the five naming systems have to be answered by a human rather than guessed.
 *
 * Duplicating goes through the CREATE route rather than a verb of its own on the
 * board: both make a board, and both have to answer to the same ceiling on how many
 * a company keeps. A second entry point is a second place for that check to be
 * forgotten.
 *
 * Gate is the Scoreboards section itself (`can_access_scoreboards`, admins bypass)
 * for CREATING — plus, for the GET list only, anyone a board has been shared with.
 * No new permission flag, deliberately: Ben's rule is that anyone can build a
 * scoreboard and share it, what they may put ON it is decided per-widget by their
 * Report access (lib/scoreboards/widgets/gating.ts), and sharing it is what lets
 * the other person read it. A second flag would gate the container while the real
 * limit lives on the contents.
 *
 * Reshaping a board goes through /api/hub/scoreboards/widgets like every other
 * board; this route owns only the board's existence and its sharing.
 */

export async function GET() {
  /* Reading the list is open to someone a board was shared with, flag or not —
   * the sidebar and the Workspace tab both read this, and a board that doesn't
   * appear in either is indistinguishable from one that wasn't shared. `listCustomBoards`
   * still applies the per-board visibility rule, so they see only theirs. */
  const resolved = await resolveScoreboardCaller({ allowSharedViewer: true })
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { caller } = resolved

  const boards = await listCustomBoards(caller.companyId, caller.userId, caller.isAdmin)
  const res = NextResponse.json({ boards })
  // The sidebar and the index both read this, and a board created seconds ago has
  // to appear — a cached list reads exactly like "creating it didn't work".
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function POST(request: Request) {
  const resolved = await resolveScoreboardCaller()
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { caller } = resolved

  const body = await request.json().catch(() => ({})) as {
    title?: unknown; cloneFrom?: unknown; forEmployeeId?: unknown
  }

  if (typeof body.cloneFrom === 'string' && body.cloneFrom) {
    const cloned = await cloneCustomBoard(
      caller.companyId, caller.userId, caller.isAdmin, body.cloneFrom, body.title,
      typeof body.forEmployeeId === 'string' && body.forEmployeeId ? body.forEmployeeId : null,
    )
    // The lib decides the status — 404 for a board this person can't see, 403 for
    // one they can see but don't own — so the route doesn't re-derive a rule that
    // already exists next to the check that produced it.
    if ('error' in cloned) return NextResponse.json({ error: cloned.error }, { status: cloned.status })
    return NextResponse.json(cloned, { status: 201 })
  }

  const created = await createCustomBoard(caller.companyId, caller.userId, body.title as string)
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: 400 })

  return NextResponse.json({ slug: created.slug }, { status: 201 })
}
