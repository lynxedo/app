import { NextResponse } from 'next/server'
import { createCustomBoard, listCustomBoards, resolveScoreboardCaller } from '@/lib/scoreboards/custom'

export const dynamic = 'force-dynamic'

/* User-built Scoreboards — list what you can open, and create a new one.
 *
 * GET  → { boards: CustomBoardSummary[] }
 * POST { title } → { slug }
 *
 * Gate is the Scoreboards section itself (`can_access_scoreboards`, admins bypass).
 * No new permission flag, deliberately: Ben's rule is that anyone can build a
 * scoreboard and share it, and what they may put ON it is decided per-widget by
 * their Report access (lib/scoreboards/widgets/gating.ts). A second flag would gate
 * the container while the real limit lives on the contents.
 *
 * Reshaping a board goes through /api/hub/scoreboards/widgets like every other
 * board; this route owns only the board's existence and its sharing.
 */

export async function GET() {
  const resolved = await resolveScoreboardCaller()
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

  const body = await request.json().catch(() => ({})) as { title?: unknown }
  const created = await createCustomBoard(caller.companyId, caller.userId, body.title as string)
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: 400 })

  return NextResponse.json({ slug: created.slug }, { status: 201 })
}
