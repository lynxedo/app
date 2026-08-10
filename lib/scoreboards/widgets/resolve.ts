/* The batched resolver — the reason widgets don't fetch for themselves.
 *
 * Collect every widget's declared source requests, run each UNIQUE query once,
 * then run the (pure, free) metrics. Board 8's ten widgets declare ten requests
 * that collapse to two queries; a user who piles six revenue widgets onto one
 * board still pays for one.
 *
 * Second benefit, almost as valuable: a failing source no longer takes the whole
 * board down. Today one bad query returns 500 and the screen is blank; here the
 * widgets that needed it show an error and everything else still renders.
 */

import { getWidgetDef } from './registry'
import { getSourceExecutor, type SourceContext } from './sources'
import { sourceKey, withDefaults, type BoardLayout, type SourceBag, type SourceRequest, type WindowSpec } from './types'
import type { WidgetPayload } from './payloads'

export type ResolvedBoard = {
  /** Payload per widget instance id. */
  data: Record<string, WidgetPayload>
  /** Per-instance failure messages, for the widgets that couldn't be built. */
  errors: Record<string, string>
  stats: {
    /** Requests the widgets asked for. */
    requested: number
    /** Queries actually run. */
    executed: number
    ms: number
  }
}

export async function resolveBoard(
  ctx: SourceContext,
  layout: BoardLayout,
  win: WindowSpec,
): Promise<ResolvedBoard> {
  const startedAt = Date.now()
  const data: Record<string, WidgetPayload> = {}
  const errors: Record<string, string> = {}

  /* 1 — collect declared requests, deduped by (source, sorted params). */
  const wanted = new Map<string, SourceRequest>()
  let requested = 0
  const plans: { id: string; type: string }[] = []

  for (const inst of layout.widgets) {
    const def = getWidgetDef(inst.type)
    if (!def) { errors[inst.id] = `Unknown widget "${inst.type}"`; continue }
    const cfg = withDefaults(def.config, inst.config)
    let reqs: SourceRequest[]
    try {
      reqs = def.sources(cfg, win)
    } catch (err) {
      errors[inst.id] = err instanceof Error ? err.message : 'Could not work out what this widget needs'
      continue
    }
    for (const r of reqs) {
      requested++
      const k = sourceKey(r)
      if (!wanted.has(k)) wanted.set(k, r)
    }
    plans.push({ id: inst.id, type: inst.type })
  }

  /* 2 — run each unique source once. A failure is recorded, not thrown, so one
         bad source can't blank the board. */
  const rowsByKey = new Map<string, unknown[]>()
  const failedByKey = new Map<string, string>()

  await Promise.all([...wanted.entries()].map(async ([key, req]) => {
    const exec = getSourceExecutor(req.source)
    if (!exec) { failedByKey.set(key, `No source named "${req.source}"`); return }
    try {
      rowsByKey.set(key, await exec(ctx, req.params))
    } catch (err) {
      failedByKey.set(key, err instanceof Error ? err.message : 'Query failed')
    }
  }))

  /* 3 — run the metrics. Pure, so this is cheap and cannot make a query. */
  for (const plan of plans) {
    const inst = layout.widgets.find(w => w.id === plan.id)
    const def = getWidgetDef(plan.type)
    if (!inst || !def) continue

    const cfg = withDefaults(def.config, inst.config)
    const missing: string[] = []
    const bag: SourceBag = {
      get<T>(req: SourceRequest): T[] {
        const k = sourceKey(req)
        const failure = failedByKey.get(k)
        if (failure) { missing.push(failure); return [] }
        return (rowsByKey.get(k) ?? []) as T[]
      },
    }

    try {
      const payload = def.metric(bag, cfg, win)
      if (missing.length) { errors[inst.id] = missing[0]; continue }
      data[inst.id] = payload
    } catch (err) {
      errors[inst.id] = err instanceof Error ? err.message : 'Could not build this widget'
    }
  }

  return {
    data,
    errors,
    stats: { requested, executed: wanted.size, ms: Date.now() - startedAt },
  }
}
