'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SortState } from '@/lib/tracker-sort'
import {
  GroupSection,
  type AnyColWithMeta,
  type StageGroup,
  type TrackerSettings,
} from '../TrackerPage'

// The default (spreadsheet) tracker view. This is the ORIGINAL table body lifted
// out of TrackerPage verbatim — the stage-grouped GroupSection map plus the
// shared horizontal-scroll machinery it depends on — so the Table cannot regress
// when the Board / Needs-me cockpit views were added. TrackerPage remains the
// single state owner; every handler is passed straight through.
export default function TableView({
  loading, groups, columns, opts, collapsedGroups, selectedIds, lightMode, sort,
  onToggleGroup, onToggleSelect, onToggleGroupAll, onUpdate, onCustomUpdate,
  onOpenNotes, onEdit, onColumnResize, onColumnReorder, onToggleSort, onSetSort,
  onAttemptNoteSaved,
}: {
  loading: boolean
  groups: StageGroup[]
  columns: AnyColWithMeta[]
  opts: TrackerSettings
  collapsedGroups: Set<string>
  selectedIds: Set<string>
  lightMode: boolean
  sort: SortState
  onToggleGroup: (key: string) => void
  onToggleSelect: (id: string) => void
  onToggleGroupAll: (ids: string[]) => void
  onUpdate: (id: string, field: string, value: unknown) => void
  onCustomUpdate: (leadId: string, columnId: string, value: string | null) => void
  onOpenNotes: (id: string) => void
  onEdit: (id: string) => void
  onColumnResize: (id: string, width: number) => void
  onColumnReorder: (fromId: string, toId: string) => void
  onToggleSort: (id: string) => void
  onSetSort: (id: string, dir: 'asc' | 'desc' | null) => void
  onAttemptNoteSaved: (leadId: string, note: string) => void
}) {
  // Shared horizontal scroll
  const hScrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [hMetrics, setHMetrics] = useState({ left: 0, client: 0, scroll: 0, track: 0 })
  const contentWidth = columns.reduce((sum, c) => sum + c.width, 0) + 56 + 56 + 24
  const measureScroll = useCallback(() => {
    const r = hScrollRef.current
    if (r) setHMetrics({ left: r.scrollLeft, client: r.clientWidth, scroll: r.scrollWidth, track: trackRef.current?.clientWidth ?? 0 })
  }, [])
  const onRealScroll = useCallback(() => {
    const r = hScrollRef.current
    if (r) setHMetrics(m => ({ ...m, left: r.scrollLeft }))
  }, [])
  const maxScroll = Math.max(0, hMetrics.scroll - hMetrics.client)
  const hOverflow = maxScroll > 1
  const thumbW = hMetrics.scroll > 0 && hMetrics.track > 0 ? Math.max(48, hMetrics.track * (hMetrics.client / hMetrics.scroll)) : 48
  const thumbLeft = maxScroll > 0 ? (hMetrics.track - thumbW) * (hMetrics.left / maxScroll) : 0

  useEffect(() => {
    const r = hScrollRef.current
    if (!r) return
    measureScroll()
    const ro = new ResizeObserver(measureScroll)
    ro.observe(r)
    if (trackRef.current) ro.observe(trackRef.current)
    return () => ro.disconnect()
  }, [contentWidth, loading, hOverflow, measureScroll])

  const nudge = (dir: number) => hScrollRef.current?.scrollBy({ left: dir * Math.max(240, hMetrics.client * 0.8), behavior: 'smooth' })
  const onThumbDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX; const startLeft = hMetrics.left; const denom = hMetrics.track - thumbW
    function onMove(ev: MouseEvent) {
      if (denom <= 0) return
      const next = startLeft + (ev.clientX - startX) * (maxScroll / denom)
      if (hScrollRef.current) hScrollRef.current.scrollLeft = Math.max(0, Math.min(maxScroll, next))
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Loading leads…</div>
  }

  return (
    <>
      <div ref={hScrollRef} onScroll={onRealScroll} className="tracker-no-sb overflow-x-auto">
        <div className="space-y-3 p-3 pb-5" style={{ minWidth: contentWidth }}>
          {groups.map(group => (
            <GroupSection key={group.key} group={group}
              collapsed={collapsedGroups.has(group.key)} onToggle={() => onToggleGroup(group.key)}
              opts={opts} selectedIds={selectedIds}
              onToggleSelect={onToggleSelect} onToggleGroupAll={onToggleGroupAll}
              onUpdate={onUpdate} onCustomUpdate={onCustomUpdate}
              onOpenNotes={onOpenNotes}
              onEdit={onEdit}
              stageColor={group.color}
              lightMode={lightMode} columns={columns}
              onColumnResize={onColumnResize} onColumnReorder={onColumnReorder}
              sort={sort}
              onToggleSort={onToggleSort}
              onSetSort={onSetSort}
              onAttemptNoteSaved={onAttemptNoteSaved} />
          ))}
        </div>
      </div>

      {hOverflow && (
        <div className="sticky bottom-0 z-20 flex items-center gap-2 px-3 py-1.5 bg-gray-950/95 backdrop-blur border-t border-gray-800">
          <button onClick={() => nudge(-1)} className="shrink-0 w-7 h-6 flex items-center justify-center rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs" aria-label="Scroll left">◀</button>
          <div ref={trackRef} onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect(); const denom = hMetrics.track - thumbW
            if (denom <= 0) return
            const next = ((e.clientX - rect.left - thumbW / 2) / denom) * maxScroll
            if (hScrollRef.current) hScrollRef.current.scrollLeft = Math.max(0, Math.min(maxScroll, next))
          }} className="relative flex-1 h-2.5 rounded-full bg-gray-800 cursor-pointer">
            <div onMouseDown={onThumbDrag} onClick={e => e.stopPropagation()}
              className="absolute top-0 h-2.5 rounded-full bg-indigo-500 hover:bg-indigo-400 cursor-grab active:cursor-grabbing transition-colors"
              style={{ width: thumbW, left: thumbLeft }} />
          </div>
          <button onClick={() => nudge(1)} className="shrink-0 w-7 h-6 flex items-center justify-center rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs" aria-label="Scroll right">▶</button>
        </div>
      )}
    </>
  )
}
