/* User-built Scoreboards — create, list, share, rename, delete.
 *
 * A custom board is a `scoreboard_layouts` row with a generated slug, an author in
 * `created_by`, and a share list in `scoreboard_layout_access`. It reuses the whole
 * widget stack unchanged: same layout tables, same batched resolver, same editor.
 * What is new is WHO may see it, and that lives here.
 *
 * Service-role client throughout, matching ./widgets/layouts.ts — the layout tables
 * are RLS-on/no-policies, so every query scopes by company_id itself and every
 * caller is a route that has already authenticated the actor.
 */

import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { CUSTOM_SLUG_PREFIX, isCustomBoardSlug } from './registry'
import { loadBoardLayout, saveLayoutWidgets } from './widgets/layouts'
import { getWidgetDef } from './widgets/registry'
import { MAX_WIDGETS_PER_BOARD, type BoardLayout } from './widgets/types'

type Admin = ReturnType<typeof createAdminClient>

/* ── who is asking ───────────────────────────────────────────────────────── */

export type ScoreboardCaller = {
  userId: string
  companyId: string
  isAdmin: boolean
  /**
   * May they CREATE a board? Holding `can_access_scoreboards` (or admin). Someone
   * who is only here because a board was shared with them may read it and nothing
   * else — see `resolveScoreboardCaller`.
   */
  canBuild: boolean
}

/**
 * The Scoreboards section gate, resolved once.
 *
 * Returns plain data, not a NextResponse, so this stays a lib function and the
 * routes own their own HTTP shapes. Anyone who can open Scoreboards can build one
 * — no separate "may build" flag, because Ben's rule puts the real limit on the
 * widgets (./widgets/gating.ts), not on the container.
 */
export async function resolveScoreboardCaller(
  opts: { allowSharedViewer?: boolean } = {},
): Promise<{ caller: ScoreboardCaller } | { status: number; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 401, error: 'Unauthorized' }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_scoreboards')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { status: 404, error: 'Profile not found' }

  const isAdmin = profile.role === 'admin'
  const companyId = profile.company_id as string
  const canBuild = isAdmin || profile.can_access_scoreboards === true

  /* ⚠ Defaults CLOSED. Only a caller that passes `allowSharedViewer` lets a
   * flag-less person through, and then only if a board really is shared with them —
   * that is the READ path (listing what you can open). Creating, renaming, sharing
   * and deleting leave this untouched and still want the section flag, so being
   * handed one board never turns into permission to make your own. */
  if (!canBuild) {
    if (!opts.allowSharedViewer) return { status: 403, error: 'Forbidden' }
    if (!(await hasViewableCustomBoard(companyId, user.id, isAdmin))) {
      return { status: 403, error: 'Forbidden' }
    }
  }
  return { caller: { userId: user.id, companyId, isAdmin, canBuild } }
}

/** A board somebody built, as the index and the sidebar list it. */
export type CustomBoardSummary = {
  slug: string
  title: string
  widgetCount: number
  createdBy: string | null
  /** This viewer built it (or is an admin) and may reshape/share/delete it. */
  canManage: boolean
  sharedAll: boolean
  /** How many people it's been named to. Undefined unless the viewer can manage it. */
  sharedWithCount?: number
  updatedAt: string | null
}

export type CustomLayoutRow = {
  id: string
  slug: string
  title: string
  created_by: string | null
  shared_all: boolean | null
  updated_at: string | null
}

const LIST_COLS = 'id, slug, title, created_by, shared_all, updated_at'

/** Hard ceiling on how many custom boards one company keeps. */
export const MAX_CUSTOM_BOARDS = 200

export function cleanBoardTitle(raw: unknown): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return t || 'New scoreboard'
}

/**
 * A random, unguessable slug rather than a slugified title.
 *
 * Two reasons it isn't `my-numbers`: renaming a board would either break its URL
 * or leave the slug lying about its contents, and a guessable slug is one more
 * thing the access check has to be the only defence for. 10 base-36 characters
 * from a CSPRNG.
 */
function newCustomSlug(): string {
  // Hex, not base64url: it is a fixed 12 characters every time and needs no
  // stripping of `-`/`_` (which would make the length, and so the entropy, vary).
  // node:crypto matches the convention used elsewhere for ids (lib/mcp-auth.ts).
  return CUSTOM_SLUG_PREFIX + randomBytes(6).toString('hex')
}

/**
 * THE visibility rule, in one function.
 *
 * Used by the list, by opening a single board, and by the data route — so a board
 * can never appear on the index that then refuses to open, or (much worse) open
 * for someone the index correctly hid. Same lesson as the report drill-downs: the
 * list must reproduce the gate exactly, so it must BE the gate.
 */
export function canViewCustomBoard(
  row: Pick<CustomLayoutRow, 'created_by' | 'shared_all'>,
  viewerUserId: string,
  isAdmin: boolean,
  sharedLayoutIds: Set<string>,
  layoutId: string,
): boolean {
  if (isAdmin) return true
  if (row.created_by === viewerUserId) return true
  if (row.shared_all === true) return true
  return sharedLayoutIds.has(layoutId)
}

/**
 * May this person reshape, rename, re-share or delete it?
 *
 * Author or admin. Deliberately NOT "any manager", which is the rule for the eight
 * shared boards we ship: those are company furniture, this is someone's own work.
 * And deliberately not the people it's shared WITH — Ben's ask was "pick who can
 * see them", and a viewer quietly editing the author's board is a different
 * feature with a different name.
 */
export function canManageCustomBoard(
  row: Pick<CustomLayoutRow, 'created_by'>,
  viewerUserId: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || row.created_by === viewerUserId
}

/** Layout ids explicitly shared with this user. */
async function sharedLayoutIdsFor(admin: Admin, userId: string): Promise<Set<string>> {
  const { data } = await admin
    .from('scoreboard_layout_access')
    .select('layout_id')
    .eq('user_id', userId)
  return new Set((data ?? []).map(r => r.layout_id as string))
}

async function allCustomRows(admin: Admin, companyId: string): Promise<CustomLayoutRow[]> {
  const { data } = await admin
    .from('scoreboard_layouts')
    .select(LIST_COLS)
    .eq('company_id', companyId)
    .like('slug', `${CUSTOM_SLUG_PREFIX}%`)
    .order('updated_at', { ascending: false })
    .limit(MAX_CUSTOM_BOARDS + 50)
  return (data ?? []) as CustomLayoutRow[]
}

/**
 * Does this person have at least one custom board they may open?
 *
 * The "is there anything inside" test for the Scoreboards section, the same shape
 * as `canOpenReportsSection` in lib/reports/registry.ts. Being shared a board is
 * ITSELF the grant: without this, sharing would take a second trip to Admin to
 * flip `can_access_scoreboards` for every person shared with, which is exactly the
 * multi-step share Ben asked us to remove.
 *
 * ⚠ Goes through `canViewCustomBoard` rather than counting share rows, because a
 * `shared_all` board carries NO row of its own — a row count would hide the
 * section from everybody it was shared with that way. Same reason `listCustomBoards`
 * uses it: the list must BE the gate, and so must this.
 */
export async function hasViewableCustomBoard(
  companyId: string,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  const admin = createAdminClient()
  const [rows, shared] = await Promise.all([
    allCustomRows(admin, companyId),
    sharedLayoutIdsFor(admin, userId),
  ])
  return rows.some(r => canViewCustomBoard(r, userId, isAdmin, shared, r.id))
}

/** The custom boards this person may open, newest-touched first. */
export async function listCustomBoards(
  companyId: string,
  userId: string,
  isAdmin: boolean,
): Promise<CustomBoardSummary[]> {
  const admin = createAdminClient()
  const [rows, shared] = await Promise.all([
    allCustomRows(admin, companyId),
    sharedLayoutIdsFor(admin, userId),
  ])
  const visible = rows.filter(r => canViewCustomBoard(r, userId, isAdmin, shared, r.id))
  if (!visible.length) return []

  const ids = visible.map(r => r.id)
  // Two small reads rather than a count per board: PostgREST has no GROUP BY, and
  // N+1 on the index page is the kind of thing that only hurts once it's in use.
  const [{ data: widgetRows }, { data: accessRows }] = await Promise.all([
    admin.from('scoreboard_layout_widgets').select('layout_id').in('layout_id', ids),
    admin.from('scoreboard_layout_access').select('layout_id').in('layout_id', ids),
  ])
  const widgetCounts = new Map<string, number>()
  for (const w of widgetRows ?? []) {
    const k = w.layout_id as string
    widgetCounts.set(k, (widgetCounts.get(k) ?? 0) + 1)
  }
  const accessCounts = new Map<string, number>()
  for (const a of accessRows ?? []) {
    const k = a.layout_id as string
    accessCounts.set(k, (accessCounts.get(k) ?? 0) + 1)
  }

  return visible.map(r => {
    const canManage = canManageCustomBoard(r, userId, isAdmin)
    return {
      slug: r.slug,
      title: r.title,
      widgetCount: widgetCounts.get(r.id) ?? 0,
      createdBy: r.created_by,
      canManage,
      sharedAll: r.shared_all === true,
      // Withheld from a plain viewer: who else can see a board is the author's
      // business, and it answers nothing useful on a read-only card.
      sharedWithCount: canManage ? (accessCounts.get(r.id) ?? 0) : undefined,
      updatedAt: r.updated_at,
    }
  })
}

export type CustomBoardResolution =
  | { ok: true; row: CustomLayoutRow; canManage: boolean }
  | { ok: false; reason: 'not-found' | 'forbidden' }

/** Resolve one custom board for a viewer, applying the same rule the list applies. */
export async function resolveCustomBoard(
  companyId: string,
  slug: string,
  userId: string,
  isAdmin: boolean,
): Promise<CustomBoardResolution> {
  if (!isCustomBoardSlug(slug)) return { ok: false, reason: 'not-found' }
  const admin = createAdminClient()
  const { data } = await admin
    .from('scoreboard_layouts')
    .select(LIST_COLS)
    .eq('company_id', companyId)
    .eq('slug', slug)
    .is('owner_user_id', null)
    .maybeSingle()
  const row = (data ?? null) as CustomLayoutRow | null
  if (!row) return { ok: false, reason: 'not-found' }

  const shared = await sharedLayoutIdsFor(admin, userId)
  if (!canViewCustomBoard(row, userId, isAdmin, shared, row.id)) {
    return { ok: false, reason: 'forbidden' }
  }
  return { ok: true, row, canManage: canManageCustomBoard(row, userId, isAdmin) }
}

/** Create an empty board. The author is its first viewer and its only manager. */
export async function createCustomBoard(
  companyId: string,
  userId: string,
  title: string,
): Promise<{ slug: string; id: string } | { error: string }> {
  const admin = createAdminClient()

  const { count } = await admin
    .from('scoreboard_layouts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .like('slug', `${CUSTOM_SLUG_PREFIX}%`)
  if ((count ?? 0) >= MAX_CUSTOM_BOARDS) {
    return { error: `A company can keep ${MAX_CUSTOM_BOARDS} scoreboards. Delete one to make room.` }
  }

  // Retry on the astronomically unlikely slug collision rather than trusting
  // randomness — the unique index is the arbiter, so a duplicate is a 23505 and
  // not a silently shared board.
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = newCustomSlug()
    // The id comes back on the insert rather than from a follow-up read: cloning
    // needs it immediately to write the copied cards, and re-reading by slug would
    // be a second round trip to learn something we were just told.
    const { data, error } = await admin.from('scoreboard_layouts').insert({
      company_id: companyId,
      slug,
      owner_user_id: null,          // shareable company object, not a private board
      title: cleanBoardTitle(title),
      is_preset: false,
      created_by: userId,
      shared_all: false,
      updated_by: userId,
    }).select('id').maybeSingle()
    if (!error && data?.id) return { slug, id: data.id as string }
    if (error && error.code !== '23505') return { error: error.message }
    if (!error) return { error: 'Could not create a scoreboard. Try again.' }
  }
  return { error: 'Could not create a scoreboard. Try again.' }
}

/**
 * The name a copy gets: "Monday numbers (copy)".
 *
 * ⚠ The STEM is trimmed to make room for the suffix, not the finished string. Chop
 * the whole thing at 80 and a long name loses the "(copy)" instead — leaving two
 * boards with identical names and nothing on screen to say the duplicate worked.
 */
export function copyBoardTitle(base: string): string {
  const suffix = ' (copy)'
  const room = 80 - suffix.length
  const stem = base.length > room ? base.slice(0, room).trimEnd() : base
  return cleanBoardTitle(stem + suffix)
}

export type CloneOutcome =
  | { slug: string; title: string; copied: number; skipped: number }
  | { status: number; error: string }

/**
 * Copy a board somebody built: same cards, same settings on each card, new board.
 *
 * ⚠⚠ THE CARDS ARE COPIED; THE AUDIENCE IS NOT. The copy starts private to whoever
 * made it, and that is the decision most worth stating out loud, because the
 * obvious implementation copies the share rows too. Two reasons not to: sharing is
 * an act, and duplicating a board would silently perform it on a list the copier
 * may never have seen (a plain viewer isn't even told how many people a board is
 * shared with — see `sharedWithCount`); and an audience inherited by accident is
 * the kind of thing nobody notices until the wrong person is reading it. The
 * Settings panel is one click away for anyone who does want the same list.
 *
 * ⚠ MANAGE, not view. Same gate as rename/share/delete, so there is one rule for
 * "may I act on this board" rather than a second, looser one just for copying.
 * Widening it later to "anyone who can open it" is a product decision, and it is
 * safe on the data (every card re-checks the VIEWER's report access at render, so
 * a copy can never show its new owner something the original didn't) — but it is
 * not what was asked for, and the narrow rule is the reversible one.
 */
export async function cloneCustomBoard(
  companyId: string,
  userId: string,
  isAdmin: boolean,
  sourceSlug: string,
  requestedTitle?: unknown,
): Promise<CloneOutcome> {
  const source = await resolveCustomBoard(companyId, sourceSlug, userId, isAdmin)
  // 404 for "no such board" AND for one they can't see, matching the rest of the
  // custom-board API: probing slugs teaches nothing about which ones exist.
  if (!source.ok) return { status: 404, error: 'Not found' }
  if (!source.canManage) {
    return { status: 403, error: 'Only the person who built this scoreboard can duplicate it' }
  }

  const layout = await loadBoardLayout(companyId, sourceSlug, userId)
  const sourceWidgets = layout?.widgets ?? []
  // Same two filters the save applies, run here so the count reported back is what
  // actually landed rather than what was attempted. A card whose type no longer
  // exists in the registry is dropped by `saveLayoutWidgets` regardless; saying
  // "9 of 10" beats a silent 9.
  const usable = sourceWidgets
    .filter(w => !!getWidgetDef(w.type))
    .slice(0, MAX_WIDGETS_PER_BOARD)

  const title = typeof requestedTitle === 'string' && requestedTitle.trim()
    ? cleanBoardTitle(requestedTitle)
    : copyBoardTitle(source.row.title)

  const created = await createCustomBoard(companyId, userId, title)
  if ('error' in created) return { status: 400, error: created.error }

  if (usable.length) {
    try {
      await saveLayoutWidgets(
        created.id,
        companyId,
        usable.map(w => ({ type: w.type, span: w.span, config: w.config })),
        userId,
      )
    } catch (err) {
      // Roll the empty board back. A duplicate that half-worked leaves a board
      // named "… (copy)" with nothing on it, which reads as the feature being
      // broken and has to be cleaned up by hand.
      await deleteCustomBoard(created.id).catch(() => {})
      return {
        status: 500,
        error: err instanceof Error ? err.message : 'Could not copy the cards onto the new scoreboard',
      }
    }
  }

  return {
    slug: created.slug,
    title,
    copied: usable.length,
    skipped: sourceWidgets.length - usable.length,
  }
}

export async function renameCustomBoard(layoutId: string, title: string, actorUserId: string): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from('scoreboard_layouts')
    .update({ title: cleanBoardTitle(title), updated_at: new Date().toISOString(), updated_by: actorUserId })
    .eq('id', layoutId)
}

export async function deleteCustomBoard(layoutId: string): Promise<void> {
  const admin = createAdminClient()
  // Widgets and share rows both cascade from the layout, so this is the whole job.
  await admin.from('scoreboard_layouts').delete().eq('id', layoutId).eq('is_preset', false)
}

/** Who a board is currently shared with, explicitly. */
export async function customBoardViewers(layoutId: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('scoreboard_layout_access')
    .select('user_id')
    .eq('layout_id', layoutId)
  return (data ?? []).map(r => r.user_id as string)
}

/**
 * Replace the share list.
 *
 * `userIds` is validated against this company's own people by the caller before it
 * gets here — a share row for someone in another tenant would be a cross-tenant
 * reference in a table that bypasses RLS.
 */
export async function setCustomBoardSharing(
  layoutId: string,
  userIds: string[],
  sharedAll: boolean,
  actorUserId: string,
): Promise<void> {
  const admin = createAdminClient()
  const wanted = [...new Set(userIds)]

  const current = await customBoardViewers(layoutId)
  const remove = current.filter(id => !wanted.includes(id))
  const add = wanted.filter(id => !current.includes(id))

  // Diffed rather than delete-then-insert: the rows carry `granted_by` and a
  // created_at that answers "since when", and rewriting the list wholesale would
  // reset both every time somebody adds one person.
  if (remove.length) {
    await admin.from('scoreboard_layout_access').delete().eq('layout_id', layoutId).in('user_id', remove)
  }
  if (add.length) {
    await admin.from('scoreboard_layout_access').insert(
      add.map(user_id => ({ layout_id: layoutId, user_id, granted_by: actorUserId })),
    )
  }
  await admin
    .from('scoreboard_layouts')
    .update({ shared_all: sharedAll, updated_at: new Date().toISOString(), updated_by: actorUserId })
    .eq('id', layoutId)
}

/** The saved layout for a custom board, widgets included. */
export async function loadCustomLayout(
  companyId: string,
  slug: string,
  userId: string,
): Promise<BoardLayout | null> {
  return loadBoardLayout(companyId, slug, userId)
}

/* ── who could actually READ this board ──────────────────────────────────── */

export type AudienceMember = {
  id: string
  name: string
}

/**
 * Who this board can be shared WITH: the live roster, minus bots and anyone off it.
 *
 * ⚠ Used to also work out, per person, which cards their Report access would hide —
 * that is gone, and deliberately. Sharing a board now shows the whole board to
 * everyone ticked (Ben, Aug 20 2026: "I want them to see the widgets no matter if
 * they have access to reports or not"), so there is nothing left to warn about, and
 * a panel that still said "won't see 3 cards" would be telling the author something
 * untrue about their own board. Being shared a board also carries access to the
 * Scoreboards section, so the old "can't open Scoreboards" note went with it.
 */
export async function previewBoardAudience(
  companyId: string,
  layoutId: string,
): Promise<AudienceMember[]> {
  void layoutId // the audience no longer depends on what is ON the board
  const admin = createAdminClient()

  const [{ data: profiles }, { data: hubUsers }] = await Promise.all([
    admin.from('user_profiles')
      .select('id, deactivated_at, locked_at')
      .eq('company_id', companyId),
    admin.from('hub_users').select('id, display_name, is_bot').eq('company_id', companyId),
  ])

  const names = new Map<string, { name: string; isBot: boolean }>()
  for (const u of hubUsers ?? []) {
    names.set(u.id as string, { name: (u.display_name as string) || 'Teammate', isBot: u.is_bot === true })
  }

  const out: AudienceMember[] = []
  for (const p of profiles ?? []) {
    const id = p.id as string
    const who = names.get(id)
    // Bots can't read a scoreboard, and someone off the roster shouldn't be
    // offered as an audience.
    if (!who || who.isBot) continue
    if (p.deactivated_at || p.locked_at) continue
    out.push({ id, name: who.name })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
