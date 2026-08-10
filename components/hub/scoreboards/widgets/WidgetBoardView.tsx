'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScoreboardMeta } from '@/lib/scoreboards/registry'
import type { WidgetCatalogEntry } from '@/lib/scoreboards/widgets/registry'
import type { BoardLayout, WidgetConfig, WidgetInstance } from '@/lib/scoreboards/widgets/types'
import { MIN_SPAN, MAX_SPAN, SPAN_STOPS } from '@/lib/scoreboards/widgets/types'
import type { WidgetPayload } from '@/lib/scoreboards/widgets/payloads'
import ScoreboardError from '@/components/hub/ScoreboardError'
import { WidgetRenderer } from './WidgetRenderer'
import { WidgetSettings } from './WidgetSettings'
import { WidgetPicker } from './WidgetPicker'

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
}

let tempSeq = 0
const tempId = () => `new-${++tempSeq}`

export default function WidgetBoardView({
  meta, businessName = 'Lynxedo', classicHref,
}: {
  meta: ScoreboardMeta
  businessName?: string
  /** Link back to the hardcoded board, for comparing numbers during migration. */
  classicHref?: string
}) {
  const [range, setRange] = useState('ytd')
  const [res, setRes] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [widgets, setWidgets] = useState<WidgetInstance[]>([])
  const [editing, setEditing] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const savedRef = useRef<WidgetInstance[]>([])
  const gridRef = useRef<HTMLDivElement | null>(null)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 2200)
  }, [])

  const load = useCallback(async (r: string) => {
    setError(null)
    setRes(null)
    try {
      const resp = await fetch(`/api/hub/scoreboards/widgets?board=${meta.slug}&range=${r}`)
      const body = (await resp.json()) as ApiResponse
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
      setRes(body)
      setWidgets(body.layout?.widgets ?? [])
      savedRef.current = body.layout?.widgets ?? []
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [meta.slug])

  useEffect(() => { void load(range) }, [load, range])

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
  const addWidget = (type: string) => {
    const def = defFor(type)
    if (!def) return
    setWidgets(list => [...list, { id: tempId(), type, span: def.defaultSpan, config: {} }])
    setPickerOpen(false)
    flash(`Added “${def.title}”`)
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
      const resp = await fetch(`/api/hub/scoreboards/widgets?range=${range}`, {
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
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-400 text-lg">🧭</div>
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-sky-50">Scoreboards</h1>
            {meta.badge ? <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-400">{meta.badge}</span> : null}
          </div>
          <div className="text-[13px] text-sky-300">{businessName} · {res?.layout?.title ?? meta.title}</div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2.5 border-b border-sky-400/15 bg-white/[0.014] px-5 py-2.5">
        <select
          value={range}
          onChange={e => setRange(e.target.value)}
          aria-label="Date range"
          className="rounded-lg border border-sky-400/15 bg-white/[0.02] px-2.5 py-1.5 text-[12px] text-sky-200"
        >
          {(win?.options ?? [{ key: 'ytd', label: 'Year to date' }]).map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        {win ? <span className="rounded-lg border border-sky-400/15 px-2.5 py-1.5 text-[12px] text-gray-400">{win.label}</span> : null}
        <button
          onClick={() => void load(range)}
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
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-amber-400/30 bg-amber-500/[0.13] px-5 py-2.5 text-[12px] text-[#fde3af]">
          <strong className="font-semibold text-amber-400">Editing.</strong>
          <span>Drag a card to move it · drag its right edge to resize · ⚙ to change what it shows</span>
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

                    {failure ? (
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

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-[11px] text-gray-600">
              {res.stats ? (
                <span title="Widgets declare their data needs; the resolver runs each unique query once.">
                  {widgets.length} widgets · {res.stats.executed} {res.stats.executed === 1 ? 'query' : 'queries'} · {res.stats.ms} ms
                </span>
              ) : null}
              <span>
                {meta.title} · updated {res.asOf ? new Date(res.asOf).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
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
