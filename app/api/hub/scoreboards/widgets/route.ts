import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGrantedBoardSlugs } from '@/lib/scoreboards/access'
import { getGrantedReportSlugs } from '@/lib/reports/access'
import type { ReportPerms } from '@/lib/reports/registry'
import { getScoreboard, isCustomBoardSlug } from '@/lib/scoreboards/registry'
import { resolveCustomBoard } from '@/lib/scoreboards/custom'
import { loadOrSeedBoardLayout, loadBoardLayout, saveLayoutWidgets, hasPreset } from '@/lib/scoreboards/widgets/layouts'
import { resolveBoard } from '@/lib/scoreboards/widgets/resolve'
import { widgetCatalog, reportsForWidget, getWidgetDef } from '@/lib/scoreboards/widgets/registry'
import { canUseWidget } from '@/lib/scoreboards/widgets/gating'
import { resolveWindow, RANGE_OPTIONS } from '@/lib/scoreboards/widgets/windows'
import { clampSpan, type BoardLayout } from '@/lib/scoreboards/widgets/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/* Widget-driven scoreboards — the preset boards we ship AND the ones users build.
 *
 * GET  ?board=<slug>&range=<key>  resolve the board for this viewer
 * PUT  { board, widgets:[...] }   replace its arrangement
 *
 * `board` is either a shipped board slug ('8') or a custom one ('custom-…'). Both
 * live in scoreboard_layouts and share the resolver; they differ in who may open
 * them and who may edit them, which is what `authorizeBoard` sorts out.
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
  /** Editing a board the whole company shares is a manager-and-up action. */
  canEditShared: boolean
  /** Report entitlements, which decide which WIDGETS are available on a custom board. */
  reportPerms: ReportPerms
}

async function resolveCaller(): Promise<{ caller: Caller } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_scoreboards, can_access_reports')
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
      // Editing a SHARED preset board changes it for everyone who can see it, so
      // it is a manager-and-up action. A CUSTOM board is instead editable by the
      // person who built it — resolved per board in authorizeBoard.
      canEditShared: isAdmin || profile.role === 'manager',
      reportPerms: {
        isAdmin,
        canAccessReports: profile.can_access_reports === true,
        // Skipped for admins, who bypass grants anyway.
        allowedReportSlugs: isAdmin ? [] : await getGrantedReportSlugs(supabase, user.id),
        // Deliberately not read. No widget maps to Call Coaching — it has no
        // widgets at all (legacyView) and no `report:coaching` preset — so it can
        // never appear in a widget's report list, and reading the flag here would
        // buy a query that cannot change an answer.
      },
    },
  }
}

type BoardAuth =
  | { ok: true; kind: 'preset' | 'custom'; canEdit: boolean }
  | { ok: false; res: NextResponse }

/**
 * May this caller open the board, and may they reshape it?
 *
 * Two different models on purpose:
 *   preset  — per-board grant (`scoreboard_board_access`), edited by manager+.
 *   custom  — the author's own share list, edited by the author (or an admin).
 */
async function authorizeBoard(caller: Caller, slug: string): Promise<BoardAuth> {
  const forbidden = { ok: false as const, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  if (isCustomBoardSlug(slug)) {
    const board = await resolveCustomBoard(caller.companyId, slug, caller.userId, caller.isAdmin)
    if (!board.ok) {
      return board.reason === 'not-found'
        ? { ok: false, res: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
        : forbidden
    }
    return { ok: true, kind: 'custom', canEdit: board.canManage }
  }

  if (slug === COACHING_SLUG) return forbidden
  if (!getScoreboard(slug)) return forbidden
  if (caller.isAdmin) return { ok: true, kind: 'preset', canEdit: caller.canEditShared }

  const supabase = await createClient()
  const allowed = await getGrantedBoardSlugs(supabase, caller.userId)
  if (!allowed.includes(slug)) return forbidden
  return { ok: true, kind: 'preset', canEdit: caller.canEditShared }
}

/**
 * Widgets on a CUSTOM board that this viewer isn't entitled to see.
 *
 * ⚠⚠ This is the enforcement, not a display nicety. Without it a shared board is
 * a side door around `report_access`: build a board with the $/labour-hour card,
 * share it with a technician, and they read four colleagues' wages — the exposure
 * the Aug-12 session closed at the RPC layer, reopened one level up. The restricted
 * widgets are dropped BEFORE the resolver runs, so their numbers are never
 * fetched, let alone sent.
 *
 * ⚠ Applies to custom boards ONLY. The eight shipped boards keep their per-board
 * grant and the preset Reports keep theirs; extending this to Board 8 would revoke
 * marketing cards from everyone who can see that board today.
 */
function restrictedWidgetIds(caller: Caller, layout: BoardLayout, kind: 'preset' | 'custom'): Set<string> {
  const out = new Set<string>()
  if (kind !== 'custom') return out
  for (const w of layout.widgets) {
    if (!canUseWidget(caller.reportPerms, reportsForWidget(w.type))) out.add(w.id)
  }
  return out
}

/** Split a layout into "what the resolver may run" and "what the client renders locked". */
function applyRestrictions(layout: BoardLayout, restricted: Set<string>) {
  if (!restricted.size) return { resolvable: layout, visible: layout }
  return {
    resolvable: { ...layout, widgets: layout.widgets.filter(w => !restricted.has(w.id)) },
    visible: {
      ...layout,
      widgets: layout.widgets.map(w => (restricted.has(w.id) ? { ...w, restricted: true } : w)),
    },
  }
}

export async function GET(request: Request) {
  const resolved = await resolveCaller()
  if ('error' in resolved) return resolved.error
  const { caller } = resolved

  const sp = new URL(request.url).searchParams
  const slug = sp.get('board') ?? ''
  const auth = await authorizeBoard(caller, slug)
  if (!auth.ok) return auth.res

  if (auth.kind === 'preset' && !hasPreset(slug)) {
    // No widget layout ships for this board yet — the caller should render the
    // existing hardcoded view. Not an error.
    return NextResponse.json({ migrated: false }, { status: 200 })
  }

  const win = resolveWindow(sp.get('range'), sp.get('start'), sp.get('end'))

  let layout
  try {
    // A custom board's row always exists (creating it is what made the slug), so
    // it loads rather than seeds — there is no preset to seed it from, and an
    // empty new board is the correct starting state.
    layout = auth.kind === 'custom'
      ? await loadBoardLayout(caller.companyId, slug, caller.userId)
      : await loadOrSeedBoardLayout(caller.companyId, slug, caller.userId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load this board' }, { status: 500 })
  }
  if (!layout) {
    return auth.kind === 'custom'
      ? NextResponse.json({ error: 'Not found' }, { status: 404 })
      : NextResponse.json({ migrated: false }, { status: 200 })
  }

  const restricted = restrictedWidgetIds(caller, layout, auth.kind)
  const { resolvable, visible } = applyRestrictions(layout, restricted)

  const supabase = await createClient()
  const resolvedBoard = await resolveBoard({
      supabase,
      rpcClient: createAdminClient(),
      companyId: caller.companyId,
      viewerUserId: caller.userId,
      // ⚠ Always false here, deliberately. The widget library is shared with
      // Scoreboards, so a People widget could be placed on a board — and a
      // board carries no per-report grant. Fail closed: on a scoreboard you
      // see your own row and nobody else's. Team-wide performance is the
      // report's job, where the grant is actually checked.
      canSeeOthersPerformance: false,
    }, resolvable, win)

  const res = NextResponse.json({
    migrated: true,
    asOf: new Date().toISOString(),
    // Echo the RESOLVED start/end back, so the picker shows what the server
    // actually used rather than what the browser asked for — an incomplete or
    // invalid custom range silently resolves to year-to-date.
    window: { ...win, range: sp.get('range') ?? 'ytd', options: RANGE_OPTIONS },
    layout: visible,
    catalog: widgetCatalog(),
    canEdit: auth.kind === 'custom' ? auth.canEdit : (auth.canEdit && layout.ownerUserId === null),
    // What the picker may offer. Sent as the viewer's own grants rather than a
    // pre-filtered catalog so a greyed-out widget can say WHICH report it needs.
    viewerReports: caller.reportPerms.allowedReportSlugs ?? [],
    viewerIsAdmin: caller.isAdmin,
    /** Custom boards get rename / share / delete controls; preset boards don't. */
    custom: auth.kind === 'custom' ? { canManage: auth.canEdit } : null,
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
  const auth = await authorizeBoard(caller, slug)
  if (!auth.ok) return auth.res
  // Edit capability first, before any load — an unauthorised PUT shouldn't be able
  // to trigger a preset seed on its way to a 403.
  if (auth.kind === 'custom' && !auth.canEdit) {
    return NextResponse.json({ error: 'Only the person who built this scoreboard can change it' }, { status: 403 })
  }
  if (auth.kind === 'preset' && !caller.canEditShared) {
    return NextResponse.json({ error: 'Only an admin or manager can change a shared board' }, { status: 403 })
  }
  if (!Array.isArray(body.widgets)) {
    return NextResponse.json({ error: 'Expected a list of widgets' }, { status: 400 })
  }

  const layout = auth.kind === 'custom'
    ? await loadBoardLayout(caller.companyId, slug, caller.userId)
    : await loadOrSeedBoardLayout(caller.companyId, slug, caller.userId)
  if (!layout) return NextResponse.json({ error: 'This board has no editable layout' }, { status: 404 })

  if (auth.kind === 'preset' && layout.ownerUserId !== null) {
    return NextResponse.json({ error: 'Personal boards are not editable yet' }, { status: 403 })
  }

  const incoming = body.widgets.map(w => ({
    type: String(w?.type ?? ''),
    span: clampSpan(w?.span),
    config: w?.config,
  }))

  if (auth.kind === 'custom') {
    /* The save-side half of the widget gate. The picker already hides what this
     * person can't use, but the picker only decides what is OFFERED — this decides
     * what is STORED, and it is the half a hand-rolled PUT cannot walk past.
     *
     * ⚠ Types ALREADY on the board are grandfathered. Not laxity: a board built
     * while its author held the Crew report, opened after that grant is revoked,
     * shows those cards locked (see restrictedWidgetIds) and sends them back
     * untouched on the next save. Rejecting them would make every subsequent edit
     * fail with a message about a card they cannot even see; dropping them would
     * delete the author's work as a side effect of a permission change. They stay,
     * and stay unreadable to them.
     */
    const alreadyOn = new Set(layout.widgets.map(w => w.type))
    const blocked = incoming.filter(w =>
      !alreadyOn.has(w.type) &&
      getWidgetDef(w.type) &&
      !canUseWidget(caller.reportPerms, reportsForWidget(w.type)),
    )
    if (blocked.length) {
      const names = blocked.map(w => getWidgetDef(w.type)?.title ?? w.type)
      return NextResponse.json({
        error: `You don't have access to the report behind ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}. Ask an admin for it, or remove the card.`,
      }, { status: 403 })
    }
  }

  try {
    await saveLayoutWidgets(layout.id, caller.companyId, incoming, caller.userId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 500 })
  }

  const putParams = new URL(request.url).searchParams
  const win = resolveWindow(putParams.get('range'), putParams.get('start'), putParams.get('end'))
  const fresh = auth.kind === 'custom'
    ? await loadBoardLayout(caller.companyId, slug, caller.userId)
    : await loadOrSeedBoardLayout(caller.companyId, slug, caller.userId)
  const supabase = await createClient()

  if (!fresh) {
    return NextResponse.json({ migrated: true, layout: null, data: {}, errors: {}, stats: { requested: 0, executed: 0, ms: 0 } })
  }

  const restricted = restrictedWidgetIds(caller, fresh, auth.kind)
  const { resolvable, visible } = applyRestrictions(fresh, restricted)
  const resolvedBoard = await resolveBoard({
    supabase,
    rpcClient: createAdminClient(),
    companyId: caller.companyId,
    viewerUserId: caller.userId,
    // Same fail-closed rule as GET — see the note there.
    canSeeOthersPerformance: false,
  }, resolvable, win)

  const res = NextResponse.json({ migrated: true, layout: visible, ...resolvedBoard })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
