import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGrantedBoardSlugs } from '@/lib/scoreboards/access'
import { getScoreboard } from '@/lib/scoreboards/registry'
import { loadOrSeedBoardLayout, saveLayoutWidgets, hasPreset } from '@/lib/scoreboards/widgets/layouts'
import { resolveBoard } from '@/lib/scoreboards/widgets/resolve'
import { widgetCatalog } from '@/lib/scoreboards/widgets/registry'
import { resolveWindow, RANGE_OPTIONS } from '@/lib/scoreboards/widgets/windows'
import { clampSpan } from '@/lib/scoreboards/widgets/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/* Widget-driven scoreboards.
 *
 * GET  ?board=<slug>&range=<key>  resolve the board for this viewer
 * PUT  { board, widgets:[...] }   replace the shared board's arrangement
 *
 * Deliberately NOT cached (the hardcoded /api/hub/scoreboards sets a 5-minute
 * private max-age). A cached response here would show a stale arrangement right
 * after someone saves an edit, and "my change didn't stick" is a worse failure
 * than recomputing. The queries behind it are the same two either way.
 *
 * Board 6 (Call Coaching) is permanently out of scope for widgets — it stays on
 * its own hardcoded view with its own gate. See REPORTS_PRD.md §9.1.5.
 */

const COACHING_SLUG = '6'

type Caller = {
  userId: string
  companyId: string
  isAdmin: boolean
  canEditShared: boolean
}

async function resolveCaller(): Promise<{ caller: Caller } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_scoreboards')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }

  const isAdmin = profile.role === 'admin'
  if (!isAdmin && !profile.can_access_scoreboards) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return {
    caller: {
      userId: user.id,
      companyId: profile.company_id,
      isAdmin,
      // Editing a SHARED board changes it for everyone who can see it, so it is a
      // manager-and-up action. Building a personal board is a separate grant and
      // is not wired yet (REPORTS_PRD.md §9.1.5).
      canEditShared: isAdmin || profile.role === 'manager',
    },
  }
}

/** Per-board view grant. Admins bypass; the coaching board is never a widget board. */
async function boardAllowed(caller: Caller, slug: string): Promise<boolean> {
  if (slug === COACHING_SLUG) return false
  if (!getScoreboard(slug)) return false
  if (caller.isAdmin) return true
  const supabase = await createClient()
  const allowed = await getGrantedBoardSlugs(supabase, caller.userId)
  return allowed.includes(slug)
}

export async function GET(request: Request) {
  const resolved = await resolveCaller()
  if ('error' in resolved) return resolved.error
  const { caller } = resolved

  const sp = new URL(request.url).searchParams
  const slug = sp.get('board') ?? ''
  if (!(await boardAllowed(caller, slug))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!hasPreset(slug)) {
    // No widget layout ships for this board yet — the caller should render the
    // existing hardcoded view. Not an error.
    return NextResponse.json({ migrated: false }, { status: 200 })
  }

  const win = resolveWindow(sp.get('range'))

  let layout
  try {
    layout = await loadOrSeedBoardLayout(caller.companyId, slug, caller.userId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load this board' }, { status: 500 })
  }
  if (!layout) return NextResponse.json({ migrated: false }, { status: 200 })

  const supabase = await createClient()
  const resolvedBoard = await resolveBoard({ supabase, companyId: caller.companyId }, layout, win)

  const res = NextResponse.json({
    migrated: true,
    asOf: new Date().toISOString(),
    window: { ...win, range: sp.get('range') ?? 'ytd', options: RANGE_OPTIONS },
    layout,
    catalog: widgetCatalog(),
    canEdit: caller.canEditShared && layout.ownerUserId === null,
    ...resolvedBoard,
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function PUT(request: Request) {
  const resolved = await resolveCaller()
  if ('error' in resolved) return resolved.error
  const { caller } = resolved

  let body: { board?: string; widgets?: { type?: string; span?: number; config?: unknown }[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const slug = String(body.board ?? '')
  if (!(await boardAllowed(caller, slug))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!caller.canEditShared) {
    return NextResponse.json({ error: 'Only an admin or manager can change a shared board' }, { status: 403 })
  }
  if (!Array.isArray(body.widgets)) {
    return NextResponse.json({ error: 'Expected a list of widgets' }, { status: 400 })
  }

  const layout = await loadOrSeedBoardLayout(caller.companyId, slug, caller.userId)
  if (!layout) return NextResponse.json({ error: 'This board has no editable layout' }, { status: 404 })
  if (layout.ownerUserId !== null) {
    return NextResponse.json({ error: 'Personal boards are not editable yet' }, { status: 403 })
  }

  try {
    await saveLayoutWidgets(
      layout.id,
      caller.companyId,
      body.widgets.map(w => ({ type: String(w?.type ?? ''), span: clampSpan(w?.span), config: w?.config })),
      caller.userId,
    )
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 500 })
  }

  const win = resolveWindow(new URL(request.url).searchParams.get('range'))
  const fresh = await loadOrSeedBoardLayout(caller.companyId, slug, caller.userId)
  const supabase = await createClient()
  const resolvedBoard = fresh
    ? await resolveBoard({ supabase, companyId: caller.companyId }, fresh, win)
    : { data: {}, errors: {}, stats: { requested: 0, executed: 0, ms: 0 } }

  const res = NextResponse.json({ migrated: true, layout: fresh, ...resolvedBoard })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
