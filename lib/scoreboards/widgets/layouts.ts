/* Reading and writing a board's layout.
 *
 * Uses the admin (service-role) client because scoreboard_layouts has RLS on
 * with no policies — every caller here has already been authorised by the route
 * (company + per-board grant + edit capability), so each query still scopes by
 * company_id itself.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getWidgetDef, BOARD_8_PRESET } from './registry'
import { clampSpan, sanitizeConfig, type BoardLayout, type WidgetInstance } from './types'

type Admin = ReturnType<typeof createAdminClient>

/** Presets we ship, keyed by board slug. A slug absent here has no widget layout. */
const PRESETS: Record<string, { title: string; widgets: typeof BOARD_8_PRESET }> = {
  '8': { title: 'Lead Sources', widgets: BOARD_8_PRESET },
}

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

  const { data: inserted, error } = await admin
    .from('scoreboard_layouts')
    .upsert(
      { company_id: companyId, slug, owner_user_id: null, title: preset.title, is_preset: true },
      { onConflict: 'company_id,slug', ignoreDuplicates: true },
    )
    .select('id, slug, title, owner_user_id, is_preset')
    .maybeSingle()
  if (error) throw new Error(`seed layout: ${error.message}`)

  // ignoreDuplicates returns nothing when the row already existed — another
  // request seeded it first, which is fine; read it back.
  let row = inserted as LayoutRow | null
  if (!row) {
    const { data } = await admin
      .from('scoreboard_layouts')
      .select('id, slug, title, owner_user_id, is_preset')
      .eq('company_id', companyId).eq('slug', slug).is('owner_user_id', null)
      .maybeSingle()
    row = data as LayoutRow | null
    if (!row) return null
    const existing = await loadWidgets(admin, row.id)
    if (existing.length) return toLayout(row, existing)
  }

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
  if (wErr) throw new Error(`seed widgets: ${wErr.message}`)

  return toLayout(row!, await loadWidgets(admin, row!.id))
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
