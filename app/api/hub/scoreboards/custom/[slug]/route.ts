import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  cleanBoardTitle,
  customBoardViewers,
  deleteCustomBoard,
  previewBoardAudience,
  renameCustomBoard,
  resolveCustomBoard,
  resolveScoreboardCaller,
  setCustomBoardSharing,
} from '@/lib/scoreboards/custom'

export const dynamic = 'force-dynamic'

/* One user-built Scoreboard: who it's shared with, its name, and deleting it.
 *
 * GET    → { board, viewers, audience }   the share panel's data
 * PATCH  { title?, sharedAll?, userIds? } rename and/or re-share
 * DELETE                                  remove the board and everything on it
 *
 * All three need MANAGE (author or admin), not merely view. Reshaping the widget
 * list is somewhere else entirely — /api/hub/scoreboards/widgets — because that is
 * the same operation on every kind of board and shares the resolver with them.
 */

type Ctx = { params: Promise<{ slug: string }> }

async function manageable(slug: string) {
  const resolved = await resolveScoreboardCaller()
  if ('error' in resolved) return { fail: NextResponse.json({ error: resolved.error }, { status: resolved.status }) }
  const { caller } = resolved

  const board = await resolveCustomBoard(caller.companyId, slug, caller.userId, caller.isAdmin)
  if (!board.ok) {
    // 404 for both "no such board" and "not yours": a viewer probing slugs learns
    // nothing about which ones exist.
    return { fail: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  if (!board.canManage) {
    return { fail: NextResponse.json({ error: 'Only the person who built this scoreboard can change it' }, { status: 403 }) }
  }
  return { caller, row: board.row }
}

export async function GET(_request: Request, { params }: Ctx) {
  const { slug } = await params
  const got = await manageable(slug)
  if ('fail' in got) return got.fail

  const [viewers, audience] = await Promise.all([
    customBoardViewers(got.row.id),
    previewBoardAudience(got.caller.companyId, got.row.id),
  ])

  const res = NextResponse.json({
    board: { slug: got.row.slug, title: got.row.title, sharedAll: got.row.shared_all === true },
    viewers,
    // Everyone in the company minus the author, each with what they'd actually see.
    audience: audience.filter(m => m.id !== got.row.created_by),
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { slug } = await params
  const got = await manageable(slug)
  if ('fail' in got) return got.fail

  const body = await request.json().catch(() => ({})) as {
    title?: unknown
    sharedAll?: unknown
    userIds?: unknown
  }

  if (typeof body.title === 'string') {
    await renameCustomBoard(got.row.id, cleanBoardTitle(body.title), got.caller.userId)
  }

  // Sharing is set as a whole (list + everyone-flag together) or not at all — a
  // partial update would let the two disagree, e.g. clearing the list while
  // shared_all stays true and the board silently remains company-wide.
  if (Array.isArray(body.userIds) || typeof body.sharedAll === 'boolean') {
    const rawIds = Array.isArray(body.userIds) ? body.userIds.map(String) : await customBoardViewers(got.row.id)
    const sharedAll = typeof body.sharedAll === 'boolean' ? body.sharedAll : got.row.shared_all === true

    // ⚠ Every id is confirmed to belong to THIS company before it becomes a row.
    // scoreboard_layout_access bypasses RLS, so an unchecked id from the browser
    // would be a cross-tenant reference written by a legitimate request.
    const admin = createAdminClient()
    const unique = [...new Set(rawIds)].slice(0, 500)
    const { data: valid } = unique.length
      ? await admin.from('user_profiles').select('id').eq('company_id', got.caller.companyId).in('id', unique)
      : { data: [] as { id: string }[] }
    const allowed = (valid ?? []).map(r => r.id as string)

    await setCustomBoardSharing(got.row.id, allowed, sharedAll, got.caller.userId)

    const dropped = unique.length - allowed.length
    if (dropped > 0) {
      // Not an error — the save stands — but say so rather than reporting success
      // on a list that was quietly trimmed.
      return NextResponse.json({ ok: true, ignored: dropped })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { slug } = await params
  const got = await manageable(slug)
  if ('fail' in got) return got.fail

  await deleteCustomBoard(got.row.id)
  return NextResponse.json({ ok: true })
}
