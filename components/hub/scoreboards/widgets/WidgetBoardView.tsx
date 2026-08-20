'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'
import type { WidgetCatalogEntry } from '@/lib/scoreboards/widgets/registry'
import type { BoardLayout, WidgetConfig, WidgetInstance } from '@/lib/scoreboards/widgets/types'
import { MIN_SPAN, MAX_SPAN, SPAN_STOPS, MAX_WIDGETS_PER_BOARD, duplicateWidgetAt } from '@/lib/scoreboards/widgets/types'
import type { WidgetPayload } from '@/lib/scoreboards/widgets/payloads'
import { getReport } from '@/lib/reports/registry'
import ScoreboardError from '@/components/hub/ScoreboardError'
import { WidgetRenderer } from './WidgetRenderer'
import { WidgetSettings } from './WidgetSettings'
import { WidgetPicker } from './WidgetPicker'
import { CustomBoardManager } from './CustomBoardManager'
import { MixedPeopleBanner } from './MixedPeopleBanner'

/* A scoreboard rendered from a saved list of widgets.
 *
 * Move and resize are POINTER-based, not HTML5 drag: it works with a finger, and
 * the board can reflow live under the cursor. Both manipulate the DOM during the
 * gesture and commit to React state on release — re-rendering ten widgets
 * (including a sortable table) on every pointermove would stutter.
 */

const COLS = 12
const GAP = 14

type ApiResponse = {
  migrated: boolean
  asOf?: string
  window?: { start: string; end: string; label: string; phrase: string; range: string; options: { key: string; label: string }[] }
  layout?: BoardLayout
  catalog?: WidgetCatalogEntry[]
  canEdit?: boolean
  data?: Record<string, WidgetPayload>
  errors?: Record<string, string>
  stats?: { requested: number; executed: number; ms: number }
  error?: string
  /** Reports this viewer may read — bounds which widgets the picker offers. */
  viewerReports?: string[]
  viewerIsAdmin?: boolean
  /** Non-null only for a board somebody built, which is the only kind you can share or delete. */
  custom?: { canManage: boolean } | null
}

/** Report titles for the lock message on a widget this viewer isn't entitled to. */
function neededReportLabel(slugs: string[] | undefined): string {
  const titles = (slugs ?? []).map(s => getReport(s)?.title).filter(Boolean) as string[]
  if (!titles.length) return 'a report you don’t have access to'
  if (titles.length === 1) return `the ${titles[0]} report`
  return `the ${titles[0]} report`
}

let tempSeq = 0
const tempId = () => `new-${++tempSeq}`

/** Which surface this is rendering. The two have different endpoints and different
 *  permission models, so it's explicit rather than a guessed default. */
export type WidgetSurface =
  | { kind: 'board'; slug: string }
  | { kind: 'report'; slug: string }

const ENDPOINT: Record<WidgetSurface['kind'], { path: string; idParam: string }> = {
  board: { path: '/api/hub/scoreboards/widgets', idParam: 'board' },
  report: { path: '/api/hub/reports/widgets', idParam: 'report' },
}

export default function WidgetBoardView({
  meta, businessName, classicHref, surface, defaultRange,
}: {
  meta: Pick<ScoreboardMeta, 'slug' | 'title'> & { badge?: string }
  /** Omitted by the Workspace-Tabs twin, which has no server context to read it
   *  from. Renders just the board name rather than inventing a company name. */
  businessName?: string
  /** Link back to the hardcoded board, for comparing numbers during migration. */
  classicHref?: string
  /** Defaults to a scoreboard, which is what every existing caller is. */
  surface?: WidgetSurface
  /** Opening window. Home wants "this month" — its tiles compare against the
   *  previous period, and year-to-date's comparison reaches back before the
   *  invoice records begin, so the deltas would all read "no comparison". */
  defaultRange?: string
}) {
  const surf: WidgetSurface = surface ?? { kind: 'board', slug: meta.slug }
  const api = ENDPOINT[surf.kind]
  const isReport = surf.kind === 'report'
  const [range, setRange] = useState(defaultRange ?? 'ytd')
  // Custom range. Both dates must be set before it's applied — a half-filled
  // range would otherwise reload the board with a nonsense window on every
  // keystroke, so the server treats an incomplete one as year-to-date.
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [res, setRes] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [widgets, setWidgets] = useState<WidgetInstance[]>([])
  const [editing, setEditing] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  // Renaming happens in the manage panel, which doesn't reload the board — so the
  // header takes the new name from here rather than waiting for a refetch.
  const [titleOverride, setTitleOverride] = useState<string | null>(null)
  const savedRef = useRef<WidgetInstance[]>([])
  const gridRef = useRef<HTMLDivElement | null>(null)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 2200)
  }, [])

  const load = useCallback(async (r: string, from?: string, to?: string) => {
    setError(null)
    setRes(null)
    try {
      const qs = new URLSearchParams({ [api.idParam]: surf.slug, range: r })
      if (r === 'custom' && from && to) { qs.set('start', from); qs.set('end', to) }
      const resp = await fetch(`${api.path}?${qs.toString()}`)
      const body = (await resp.json()) as ApiResponse
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      setRes(body)
      setWidgets(body.layout?.widgets ?? [])
      savedRef.current = body.layout?.widgets ?? []
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api.path, api.idParam, surf.slug])

  // For a custom range, wait until both ends are filled in.
  useEffect(() => {
    if (range === 'custom' && !(customStart && customEnd)) return
    void load(range, customStart, customEnd)
  }, [load, range, customStart, customEnd])

  /* ── edit actions ─────────────────────────────────────────────────────── */

  const patchConfig = (id: string, key: string, value: unknown) => {
    setWidgets(list => list.map(w => (w.id === id ? { ...w, config: { ...w.config, [key]: value } as WidgetConfig } : w)))
  }
  const setSpan = (id: string, span: number) => {
    setWidgets(list => list.map(w => (w.id === id ? { ...w, span } : w)))
  }
  const removeWidget = (id: string) => {
    const gone = widgets.find(w => w.id === id)
    setWidgets(list => list.filter(w => w.id !== id))
    setOpenId(null)
    if (gone) flash(`Removed “${defFor(gone.type)?.title ?? gone.type}”`)
  }
  /** The board is full. Says so instead of letting the save quietly drop the tail. */
  const atCapacity = () => {
    if (widgets.length < MAX_WIDGETS_PER_BOARD) return false
    flash(`A scoreboard holds ${MAX_WIDGETS_PER_BOARD} cards — remove one to make room`)
    return true
  }

  const addWidget = (type: string) => {
    const def = defFor(type)
    if (!def) return
    if (atCapacity()) return
    setWidgets(list => [...list, { id: tempId(), type, span: def.defaultSpan, config: {} }])
    setPickerOpen(false)
    flash(`Added “${def.title}”`)
  }

  /**
   * A second copy of a card, with its settings, landing next to the original.
   *
   * The picker can already add another of the same TYPE — what it can't do is bring
   * the configuration, and the configuration is the work: "Book Size, WF only" then
   * duplicated and switched to IR is two clicks, where re-adding it means finding
   * the card and re-ticking everything. Straight after the original rather than at
   * the end, so the pair can be compared without hunting.
   */
  const duplicateWidget = (index: number) => {
    const src = widgets[index]
    if (!src) return
    if (atCapacity()) return
    const id = tempId()
    setWidgets(list => duplicateWidgetAt(list, index, id))
    flash(`Duplicated “${defFor(src.type)?.title ?? src.type}” — change the copy in ⚙`)
  }
  const nudge = (index: number, by: number) => {
    setWidgets(list => {
      const next = [...list]
      const to = index + by
      if (to < 0 || to >= next.length) return list
      const [m] = next.splice(index, 1)
      next.splice(to, 0, m)
      return next
    })
  }

  function defFor(type: string): WidgetCatalogEntry | undefined {
    return res?.catalog?.find(c => c.type === type)
  }

  const discard = () => {
    setWidgets(savedRef.current)
    setEditing(false)
    setOpenId(null)
    flash('Changes discarded')
  }

  const save = async () => {
    setSaving(true)
    try {
      const saveQs = new URLSearchParams({ range })
      if (range === 'custom' && customStart && customEnd) {
        saveQs.set('start', customStart); saveQs.set('end', customEnd)
      }
      const resp = await fetch(`/api/hub/scoreboards/widgets?${saveQs.toString()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: meta.slug,
          widgets: widgets.map(w => ({ type: w.type, span: w.span, config: w.config })),
        }),
      })
      const body = (await resp.json()) as ApiResponse
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      setRes(prev => (prev ? { ...prev, layout: body.layout, data: body.data, errors: body.errors, stats: body.stats } : prev))
      setWidgets(body.layout?.widgets ?? widgets)
      savedRef.current = body.layout?.widgets ?? widgets
      setEditing(false)
      setOpenId(null)
      flash('Saved — everyone with access sees this now')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  /* ── pointer gestures ─────────────────────────────────────────────────── */

  const colWidth = () => {
    const g = gridRef.current
    if (!g) return 0
    const total = g.getBoundingClientRect().width
    return (total - GAP * (COLS - 1)) / COLS
  }

  const startResize = (e: React.PointerEvent, id: string, from: number) => {
    e.preventDefault()
    e.stopPropagation()
    const card = (e.currentTarget as HTMLElement).closest('[data-widget]') as HTMLElement | null
    if (!card) return
    const startX = e.clientX
    const startW = card.getBoundingClientRect().width
    let span = from
    card.dataset.resizing = '1'

    const move = (ev: PointerEvent) => {
      const col = colWidth()
      // A hidden or zero-width grid makes this division meaningless — hold the
      // current size rather than snapping everything to full width.
      if (!(col > 0)) return
      const next = Math.min(MAX_SPAN, Math.max(MIN_SPAN, Math.round((startW + (ev.clientX - startX) + GAP) / (col + GAP))))
      if (next !== span) {
        span = next
        card.style.gridColumn = `span ${span}`
        const label = card.querySelector('[data-sizehint]') as HTMLElement | null
        if (label) label.textContent = SPAN_STOPS.find(s => s.span === span)?.label ?? `${span}/12`
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      delete card.dataset.resizing
      setSpan(id, span)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startMove = (e: React.PointerEvent, id: string) => {
    if (!editing) return
    if ((e.target as HTMLElement).closest('button,select,input,summary,[data-resize],th')) return
    const grid = gridRef.current
    const card = (e.currentTarget as HTMLElement) as HTMLElement
    if (!grid) return
    const startX = e.clientX, startY = e.clientY
    let live = false

    const move = (ev: PointerEvent) => {
      if (!live) {
        if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return
        live = true
        card.dataset.dragging = '1'
      }
      ev.preventDefault()
      const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-widget]'))
      for (const other of cards) {
        if (other === card) continue
        const r = other.getBoundingClientRect()
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
          if (ev.clientX > r.left + r.width / 2) other.after(card)
          else other.before(card)
          return
        }
      }
      const last = cards[cards.length - 1]
      if (last && last !== card && ev.clientY > last.getBoundingClientRect().bottom) last.after(card)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!live) return
      delete card.dataset.dragging
      const order = Array.from(grid.querySelectorAll<HTMLElement>('[data-widget]')).map(el => el.dataset.widget)
      setWidgets(list => [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)))
      flash('Moved')
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
  }

  /* ── render ───────────────────────────────────────────────────────────── */

  if (error) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)]">
        <ScoreboardError error={error} onRetry={() => void load(range)} />
      </div>
    )
  }

  const win = res?.window
  const canEdit = res?.canEdit === true
  const openWidget = widgets.find(w => w.id === openId) ?? null
  const openDef = openWidget ? defFor(openWidget.type) : undefined

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-gray-200">
      {/* Gesture states are set on the CARD during a drag but styled on the card
          AND a child, which parent-state selectors express far more plainly than
          Tailwind arbitrary variants can. */}
      <style>{`
        [data-widget][data-dragging]{opacity:.5;border-style:solid!important;border-color:#f59e0b!important;
          box-shadow:0 10px 26px rgba(0,0,0,.45);z-index:5;cursor:grabbing}
        [data-widget][data-resizing]{border-style:solid!important;border-color:#f59e0b!important}
        [data-widget][data-resizing] [data-sizehint]{opacity:1}
      `}</style>

      <header className="flex items-center gap-3.5 border-b border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-400 text-lg">
          {isReport ? '📊' : '🧭'}
        </div>
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-sky-50">{isReport ? 'Reports' : 'Scoreboards'}</h1>
            {meta.badge ? <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-400">{meta.badge}</span> : null}
          </div>
          <div className="text-[13px] text-sky-300">
            {businessName ? `${businessName} · ` : ''}{titleOverride ?? res?.layout?.title ?? meta.title}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2.5 border-b border-sky-400/15 bg-white/[0.014] px-5 py-2.5">
        <select
          value={range}
          onChange={e => {
            const next = e.target.value
            // Seed a custom range from whatever is on screen, so switching to it
            // starts from the current window instead of two empty boxes.
            if (next === 'custom' && !(customStart && customEnd) && win) {
              setCustomStart(win.start)
              setCustomEnd(win.end)
            }
            setRange(next)
          }}
          aria-label="Date range"
          className="rounded-lg border border-sky-400/15 bg-white/[0.02] px-2.5 py-1.5 text-[12px] text-sky-200"
        >
          {(win?.options ?? [{ key: 'ytd', label: 'Year to date' }]).map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        {range === 'custom' ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <input
              type="date" aria-label="Range start" value={customStart} max={customEnd || undefined}
              onChange={e => setCustomStart(e.target.value)}
              className="rounded-lg border border-sky-400/15 bg-[#020c16]/60 px-2 py-1.5 text-[12px] text-sky-200"
            />
            <span className="text-[12px] text-gray-500">to</span>
            <input
              type="date" aria-label="Range end" value={customEnd} min={customStart || undefined}
              onChange={e => setCustomEnd(e.target.value)}
              className="rounded-lg border border-sky-400/15 bg-[#020c16]/60 px-2 py-1.5 text-[12px] text-sky-200"
            />
            {!(customStart && customEnd) ? (
              <span className="text-[11px] text-amber-400">pick both dates</span>
            ) : null}
          </span>
        ) : win ? (
          <span className="rounded-lg border border-sky-400/15 px-2.5 py-1.5 text-[12px] text-gray-400">{win.label}</span>
        ) : null}
        <button
          onClick={() => void load(range, customStart, customEnd)}
          className="rounded-lg border border-sky-400/15 px-2.5 py-1.5 text-[12px] text-gray-400 hover:border-sky-400/40 hover:text-sky-200"
        >
          ↻ Refresh
        </button>
        <div className="flex-1" />
        {classicHref ? (
          <a href={classicHref} className="text-[11px] text-gray-500 underline decoration-dotted hover:text-sky-300">
            Compare with the old board
          </a>
        ) : null}
        {canEdit ? (
          <button
            aria-pressed={editing}
            onClick={() => { setEditing(v => !v); setOpenId(null) }}
            className={`rounded-lg border px-2.5 py-1.5 text-[12px] ${editing ? 'border-amber-400/50 bg-amber-500/[0.13] text-amber-400' : 'border-sky-400/15 text-gray-400 hover:border-sky-400/40 hover:text-sky-200'}`}
          >
            {editing ? '✓ Done editing' : '✎ Edit board'}
          </button>
        ) : null}
        {res?.custom?.canManage ? (
          /* ⚠ This button used to read "👥 Share" while the panel it opens also
           * RENAMES and DELETES the board. Ben went looking for both and reasonably
           * never clicked it — a control has to name everything behind it, not the
           * one thing it was first built for. "Edit board" (arrange the cards) and
           * "Settings" (name, audience, delete) are the two halves. */
          <button
            onClick={() => setManageOpen(true)}
            className="rounded-lg border border-sky-400/15 px-2.5 py-1.5 text-[12px] text-gray-400 hover:border-sky-400/40 hover:text-sky-200"
          >
            ⚙ Settings
          </button>
        ) : null}
      </div>

      <MixedPeopleBanner slug={meta.slug} canManage={!!res?.custom?.canManage} />

      {editing ? (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-amber-400/30 bg-amber-500/[0.13] px-5 py-2.5 text-[12px] text-[#fde3af]">
          <strong className="font-semibold text-amber-400">Editing.</strong>
          <span>Drag a card to move it · drag its right edge to resize · ⧉ to copy it · ⚙ to change what it shows</span>
          <div className="flex-1" />
          <button onClick={discard} className="rounded-lg border border-amber-400/45 px-3 py-1.5 text-[12px]">Discard</button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-[#291a00] hover:brightness-110 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save for everyone'}
          </button>
        </div>
      ) : null}

      <div className="px-5 pb-8 pt-2">
        {!res ? (
          <div className="py-16 text-center text-sm text-gray-500">Loading scoreboard…</div>
        ) : (
          <>
            <div
              ref={gridRef}
              className="grid gap-3.5"
              style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
            >
              {widgets.map((w, idx) => {
                const payload = res.data?.[w.id]
                const failure = res.errors?.[w.id]
                const def = defFor(w.type)
                return (
                  <div
                    key={w.id}
                    data-widget={w.id}
                    onPointerDown={e => startMove(e, w.id)}
                    style={{ gridColumn: `span ${w.span}` }}
                    className={`group/w relative overflow-hidden rounded-2xl border bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] p-[18px] max-md:!col-span-full ${editing ? 'cursor-grab touch-none border-dashed border-amber-400/40 hover:border-amber-500' : 'border-sky-400/[0.12]'}`}
                  >
                    <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-sky-500 via-sky-400 to-transparent" />

                    {editing ? (
                      <>
                        <div className="absolute right-3 top-3 z-[3] flex gap-1">
                          <button onClick={() => nudge(idx, -1)} aria-label="Move earlier" className="grid h-6 w-6 place-items-center rounded-md border border-amber-400/35 text-[12px] text-amber-200 hover:bg-amber-500 hover:text-[#291a00]">↑</button>
                          <button onClick={() => nudge(idx, 1)} aria-label="Move later" className="grid h-6 w-6 place-items-center rounded-md border border-amber-400/35 text-[12px] text-amber-200 hover:bg-amber-500 hover:text-[#291a00]">↓</button>
                          {/* Not offered on a locked card: you'd get a second card
                              you also can't read, and copying the settings of
                              something you were never shown isn't a thing to offer. */}
                          {!w.restricted ? (
                            <button onClick={() => duplicateWidget(idx)} aria-label="Duplicate this card" title="Duplicate this card" className="grid h-6 w-6 place-items-center rounded-md border border-amber-400/35 text-[12px] text-amber-200 hover:bg-amber-500 hover:text-[#291a00]">⧉</button>
                          ) : null}
                          <button onClick={() => setOpenId(w.id)} aria-label="Widget settings" className="grid h-6 w-6 place-items-center rounded-md border border-amber-400/35 text-[12px] text-amber-200 hover:bg-amber-500 hover:text-[#291a00]">⚙</button>
                        </div>
                        <div
                          data-resize
                          onPointerDown={e => startResize(e, w.id, w.span)}
                          title="Drag to resize"
                          className="absolute bottom-2 right-0 top-2 z-[4] w-3 cursor-col-resize after:absolute after:right-1 after:top-1/2 after:h-6 after:w-[3px] after:-translate-y-1/2 after:rounded-sm after:bg-amber-400/50 hover:after:bg-amber-500"
                        />
                        <div data-sizehint className="pointer-events-none absolute right-6 top-9 z-[3] rounded bg-[#291a00]/85 px-1.5 text-[10px] font-semibold text-amber-400 opacity-0 transition-opacity group-hover/w:opacity-100">
                          {SPAN_STOPS.find(s => s.span === w.span)?.label ?? `${w.span}/12`}
                        </div>
                      </>
                    ) : null}

                    {w.restricted ? (
                      /* Present but locked. The numbers were never fetched — the
                         server drops a restricted widget before the resolver runs —
                         so this card is the whole of what reaches the browser. It
                         stays on the board rather than vanishing so that its author
                         saving a move can't silently delete it. */
                      <div className="min-h-[90px]">
                        <div className="text-[13px] font-semibold text-gray-400">{def?.title ?? w.type}</div>
                        <div className="mt-2 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[11.5px] leading-snug text-gray-400">
                          <span aria-hidden>🔒</span>
                          <span>
                            Hidden — you need {neededReportLabel(def?.reports)} to see this.
                            Ask an admin for access.
                          </span>
                        </div>
                      </div>
                    ) : failure ? (
                      <div className="min-h-[90px]">
                        <div className="text-[13px] font-semibold text-sky-200">{def?.title ?? w.type}</div>
                        <div className="mt-2 rounded-lg border border-red-400/25 bg-red-500/[0.06] p-2.5 text-[11.5px] leading-snug text-red-200">
                          {failure}
                        </div>
                      </div>
                    ) : payload ? (
                      <WidgetRenderer payload={payload} />
                    ) : (
                      <div className="min-h-[90px]">
                        <div className="text-[13px] font-semibold text-sky-200">{def?.title ?? w.type}</div>
                        <div className="mt-2 text-[11.5px] text-gray-500">
                          {editing ? 'Save the board to load this widget’s numbers.' : 'No data for this widget.'}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {editing ? (
                <button
                  onClick={() => setPickerOpen(true)}
                  style={{ gridColumn: 'span 4' }}
                  className="flex min-h-[112px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-amber-400/45 bg-amber-500/[0.05] text-[13px] text-[#fde3af] hover:border-amber-500 hover:bg-amber-500/10 max-md:!col-span-full"
                >
                  <span>＋</span><span>Add a widget</span>
                </button>
              ) : null}
            </div>

            {/* A brand-new board is empty, and an empty grid with no prompt reads as
                broken rather than blank. Only shown to someone who can actually fill
                it; a viewer of an empty board is told plainly that it's empty. */}
            {widgets.length === 0 && !editing ? (
              <div className="rounded-2xl border border-dashed border-sky-400/25 bg-white/[0.02] p-8 text-center">
                <div className="text-2xl">🧭</div>
                {canEdit ? (
                  <>
                    <p className="mt-2 text-[14px] font-semibold text-sky-100">Nothing on this scoreboard yet</p>
                    <p className="mx-auto mt-1 max-w-md text-[12px] text-gray-400">
                      Pick the cards you want from the same library the preset Reports are built from.
                      You’ll see the ones covered by the reports you have access to.
                    </p>
                    <button
                      onClick={() => { setEditing(true); setPickerOpen(true) }}
                      className="mt-4 rounded-lg bg-sky-500 px-3.5 py-2 text-[12.5px] font-semibold text-[#fff] hover:brightness-110"
                    >
                      ＋ Add your first widget
                    </button>
                  </>
                ) : (
                  <p className="mt-2 text-[13px] text-gray-400">
                    This scoreboard is empty — whoever built it hasn’t added any cards yet.
                  </p>
                )}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-[11px] text-gray-600">
              {res.stats ? (
                <span title="Widgets declare their data needs; the resolver runs each unique query once.">
                  {widgets.length} widgets · {res.stats.executed} {res.stats.executed === 1 ? 'query' : 'queries'} · {res.stats.ms} ms
                </span>
              ) : null}
              <span>
                {meta.title}{isReport ? ' · preset report' : ''} · updated {res.asOf ? new Date(res.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
              </span>
            </div>
          </>
        )}
      </div>

      {openWidget && openDef ? (
        <>
          <button className="fixed inset-0 z-40 cursor-default bg-[#020a12]/60" aria-label="Close settings" onClick={() => setOpenId(null)} />
          <div className="fixed inset-y-0 right-0 z-50">
            <WidgetSettings
              def={openDef}
              span={openWidget.span}
              config={openWidget.config}
              windowLabel={win?.label ?? ''}
              onConfig={(k, v) => patchConfig(openWidget.id, k, v)}
              onSpan={s => setSpan(openWidget.id, s)}
              onRemove={() => removeWidget(openWidget.id)}
              onClose={() => setOpenId(null)}
            />
          </div>
        </>
      ) : null}

      {pickerOpen && res?.catalog ? (
        <WidgetPicker
          catalog={res.catalog}
          present={widgets.map(w => w.type)}
          onAdd={addWidget}
          onClose={() => setPickerOpen(false)}
          /* Report-gated on a board somebody built; ungated on the boards we ship,
             whose cards answer to their own per-board grant. Passing undefined is
             what turns the gate off, so the preset boards keep today's library. */
          allowedReports={res.custom ? (res.viewerReports ?? []) : undefined}
          viewerIsAdmin={res.viewerIsAdmin}
        />
      ) : null}

      {manageOpen ? (
        <CustomBoardManager
          slug={surf.slug}
          onClose={() => setManageOpen(false)}
          onRenamed={t => setTitleOverride(t)}
          /* Full navigation rather than router.push: this component is also
             rendered inside a kept-alive Workspace tab, where pushing a route
             leaves the tab mounted on a board that no longer exists. */
          onDeleted={() => window.location.assign('/hub/scoreboards')}
          /* Full navigation for the same reason as onDeleted: inside a kept-alive
             Workspace tab a router push renders the new board in the tab area
             with no tab of its own, so it opens unnamed and unclosable. */
          onDuplicated={newSlug => window.location.assign(`/hub/scoreboards/${newSlug}`)}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-sky-400/15 bg-[#0b2135] px-4 py-2 text-[12px] text-sky-200 shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  )
}
