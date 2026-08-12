/* Reading and writing a board's layout.
 *
 * Uses the admin (service-role) client because scoreboard_layouts has RLS on
 * with no policies — every caller here has already been authorised by the route
 * (company + per-board grant + edit capability), so each query still scopes by
 * company_id itself.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getWidgetDef, BOARD_8_PRESET, WIDGET_BOARD_SLUGS, REPORT_PRESETS } from './registry'
import { clampSpan, sanitizeConfig, type BoardLayout, type WidgetInstance } from './types'

type Admin = ReturnType<typeof createAdminClient>

/**
 * Presets we ship, keyed by layout slug. A slug absent here has no widget layout.
 * Boards use bare slugs ('8'); Reports use `report:<slug>`, so the two share these
 * tables without any chance of collision.
 */
const PRESETS: Record<string, { title: string; widgets: typeof BOARD_8_PRESET }> = {
  '8': { title: 'Lead Sources', widgets: BOARD_8_PRESET },
  ...REPORT_PRESETS,
}

// The client-safe slug list in ./registry drives which boards RENDER as widgets;
// this map holds what they're seeded WITH. If they ever disagree, a board renders
// the widget shell and then finds no layout to seed — so fail loudly at import.
const presetMismatch = WIDGET_BOARD_SLUGS.filter(s => !(s in PRESETS))
if (presetMismatch.length) {
  throw new Error(`Widget board(s) ${presetMismatch.join(', ')} have no preset defined`)
}

/** @deprecated prefer hasWidgetLayout from ./registry — it works on the client too. */
export function hasPreset(slug: string): boolean {
  return slug in PRESETS
}

type LayoutRow = { id: string; slug: string; title: string; owner_user_id: string | null; is_preset: boolean }
type WidgetRow = { id: string; widget_type: string; span: number; config: unknown; position: number }

function toLayout(row: LayoutRow, widgets: WidgetRow[]): BoardLayout {
  const instances: WidgetInstance[] = []
  for (const w of widgets) {
    const def = getWidgetDef(w.widget_type)
    // Keep an unknown type rather than dropping it: the resolver reports it per
    // widget, so a renamed registry entry is visible instead of silently vanishing.
    instances.push({
      id: w.id,
      type: w.widget_type,
      span: clampSpan(w.span),
      config: def ? sanitizeConfig(def.config, w.config) : {},
    })
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    ownerUserId: row.owner_user_id,
    isPreset: row.is_preset,
    widgets: instances,
  }
}

async function loadWidgets(admin: Admin, layoutId: string): Promise<WidgetRow[]> {
  const { data } = await admin
    .from('scoreboard_layout_widgets')
    .select('id, widget_type, span, config, position')
    .eq('layout_id', layoutId)
    .order('position', { ascending: true })
  return (data ?? []) as WidgetRow[]
}

/**
 * The layout to render for this user: their personal one for the slug if they
 * have it, otherwise the company's shared one. Returns null when neither exists
 * (so the caller falls back to the hardcoded board).
 */
export async function loadBoardLayout(
  companyId: string,
  slug: string,
  userId: string,
): Promise<BoardLayout | null> {
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('scoreboard_layouts')
    .select('id, slug, title, owner_user_id, is_preset')
    .eq('company_id', companyId)
    .eq('slug', slug)
    .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
  const list = (rows ?? []) as LayoutRow[]
  if (!list.length) return null

  // Personal beats shared for the same slug.
  const row = list.find(r => r.owner_user_id === userId) ?? list.find(r => r.owner_user_id === null)
  if (!row) return null
  return toLayout(row, await loadWidgets(admin, row.id))
}

/** Create the shipped preset for a slug the first time someone opens it. */
export async function seedPresetLayout(companyId: string, slug: string): Promise<BoardLayout | null> {
  const preset = PRESETS[slug]
  if (!preset) return null
  const admin = createAdminClient()

  const readShared = async (): Promise<LayoutRow | null> => {
    const { data } = await admin
      .from('scoreboard_layouts')
      .select('id, slug, title, owner_user_id, is_preset')
      .eq('company_id', companyId).eq('slug', slug).is('owner_user_id', null)
      .maybeSingle()
    return (data ?? null) as LayoutRow | null
  }

  /* ⚠ NOT an upsert. The shared-slug uniqueness is a PARTIAL index
   * (`... (company_id, slug) WHERE owner_user_id IS NULL`), and Postgres will not
   * accept a partial index as an ON CONFLICT arbiter — `onConflict:
   * 'company_id,slug'` fails outright with "there is no unique or exclusion
   * constraint matching the ON CONFLICT specification". The partial index is
   * right: a plain unique on (company_id, slug) would stop anyone having a
   * personal board on the same slug as the shared one, since NULLs don't collide.
   *
   * So: insert, and treat a unique violation as "someone else got here first".
   * See memory lesson_postgrest_upsert_partial_index. */
  let row = await readShared()

  if (!row) {
    const { data: inserted, error } = await admin
      .from('scoreboard_layouts')
      .insert({ company_id: companyId, slug, owner_user_id: null, title: preset.title, is_preset: true })
      .select('id, slug, title, owner_user_id, is_preset')
      .maybeSingle()

    if (error) {
      // 23505 = unique violation: a concurrent request created it. Anything else
      // is a real failure worth surfacing.
      if (error.code !== '23505') throw new Error(`seed layout: ${error.message}`)
      row = await readShared()
    } else {
      row = (inserted ?? null) as LayoutRow | null
    }
  }
  if (!row) return null

  const existing = await loadWidgets(admin, row.id)
  if (existing.length) return toLayout(row, existing)

  // Seed the preset. Two requests opening the board at once could both reach here
  // with zero widgets, so correctness rests on the unique index on
  // (layout_id, position): the second insert fails as a duplicate instead of
  // doubling every card, and that failure is swallowed because the winner's rows
  // are exactly what we wanted.
  const widgets = preset.widgets.map((w, i) => {
    const def = getWidgetDef(w.type)
    return {
      layout_id: row!.id,
      position: i,
      widget_type: w.type,
      span: clampSpan(w.span),
      config: def ? sanitizeConfig(def.config, w.config ?? {}) : {},
    }
  })
  const { error: wErr } = await admin.from('scoreboard_layout_widgets').insert(widgets)
  if (wErr && wErr.code !== '23505') throw new Error(`seed widgets: ${wErr.message}`)

  return toLayout(row, await loadWidgets(admin, row.id))
}

/** Load, seeding the preset if this company hasn't got one yet. */
export async function loadOrSeedBoardLayout(
  companyId: string,
  slug: string,
  userId: string,
): Promise<BoardLayout | null> {
  const existing = await loadBoardLayout(companyId, slug, userId)
  if (existing) return existing
  if (!hasPreset(slug)) return null
  return seedPresetLayout(companyId, slug)
}

/**
 * Load a REPORT layout, keeping it in step with the preset in code.
 *
 * ⚠⚠ THE BUG THIS EXISTS TO FIX. `loadOrSeedBoardLayout` seeds once and thereafter
 * only loads, so the stored rows are frozen at whatever the preset said the FIRST
 * time anyone opened that report. Every widget added to a preset afterwards is
 * invisible forever — no error, no empty card, just absent, which is
 * indistinguishable from never having shipped. It bit immediately: report:clients
 * was seeded with 8 cards, three maps were added to its preset, and the page kept
 * rendering 8.
 *
 * This is safe for Reports and ONLY for Reports, for a specific reason: a Report is
 * a locked arrangement — `app/api/hub/reports/widgets` has no PUT by design — so
 * there are no user edits to overwrite, and the preset genuinely IS the source of
 * truth. Scoreboards keep load-or-seed, because those are user-edited and resyncing
 * them would silently discard someone's board.
 *
 * Normal case costs nothing: the comparison is on the in-memory list and only a
 * genuine mismatch writes. A failed resync returns the STALE layout rather than an
 * error — a report missing a new card beats a report that won't open.
 */
export async function loadReportLayoutInSync(
  companyId: string,
  slug: string,
  userId: string,
): Promise<BoardLayout | null> {
  const layout = await loadOrSeedBoardLayout(companyId, slug, userId)
  if (!layout) return null

  const preset = PRESETS[slug]
  if (!preset) return layout

  const inStep =
    layout.widgets.length === preset.widgets.length &&
    layout.widgets.every((w, i) => w.type === preset.widgets[i].type && w.span === preset.widgets[i].span)
  if (inStep) return layout

  try {
    await saveLayoutWidgets(
      layout.id,
      companyId,
      preset.widgets.map(w => ({ type: w.type, span: w.span })),
      userId,
    )
    return (await loadBoardLayout(companyId, slug, userId)) ?? layout
  } catch (err) {
    console.error(`[layouts] report preset resync failed for ${slug}:`, err)
    return layout
  }
}

export type SaveWidgetInput = { type: string; span: number; config?: unknown }

/**
 * Replace a layout's widget list wholesale. Delete-then-insert rather than a
 * diff: the list is short, position is meaningless across saves, and a partial
 * failure leaving half a board is worse than redoing the write.
 */
export async function saveLayoutWidgets(
  layoutId: string,
  companyId: string,
  widgets: SaveWidgetInput[],
  actorUserId: string,
): Promise<void> {
  const admin = createAdminClient()

  // Re-check ownership rather than trusting the caller's layout id.
  const { data: owned } = await admin
    .from('scoreboard_layouts')
    .select('id')
    .eq('id', layoutId).eq('company_id', companyId)
    .maybeSingle()
  if (!owned) throw new Error('Layout not found for this company')

  const clean = widgets
    .filter(w => !!getWidgetDef(w.type))
    .slice(0, 60)                                   // a board nobody can read is not a feature
    .map((w, i) => {
      const def = getWidgetDef(w.type)!
      return {
        layout_id: layoutId,
        position: i,
        widget_type: w.type,
        span: clampSpan(w.span),
        config: sanitizeConfig(def.config, w.config),
      }
    })

  const { error: delErr } = await admin.from('scoreboard_layout_widgets').delete().eq('layout_id', layoutId)
  if (delErr) throw new Error(`clear widgets: ${delErr.message}`)

  if (clean.length) {
    const { error: insErr } = await admin.from('scoreboard_layout_widgets').insert(clean)
    if (insErr) throw new Error(`save widgets: ${insErr.message}`)
  }
  await admin
    .from('scoreboard_layouts')
    .update({ updated_at: new Date().toISOString(), updated_by: actorUserId })
    .eq('id', layoutId)
}
