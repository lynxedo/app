'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  type DispatchSettings, type DispatchStop, addDays, fmtClock, hhmmToMinutes, stopColor, stopMatchesGroup, todayLocal,
} from '@/lib/dispatch'

// Dispatch Week + Month views (Reference/PRDs/DISPATCH_ROUTING_PRD.md Phase 3).
// Read-only overview from the Hub mirror; click a day to open its live Day view,
// where moves happen. Week = a mini timeline strip per tech per day; Month =
// counts per tech + the first few names, like Jobber's month.

type RangeStop = DispatchStop & { startMin: number | null; endMin: number | null; locked: boolean }

interface Props {
  view: 'week' | 'month'
  date: string
  team: string[]
  settings: DispatchSettings
  filters: { groups: string[]; hideZero: boolean }
  userName: (id: string) => string
  laneColor: (id: string) => string
  onOpenDay: (date: string) => void
}

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
/** Monday on or before `d`. */
const weekStart = (d: string) => addDays(d, -((weekday(d) + 6) % 7))
const dayNum = (d: string) => Number(d.slice(8, 10))
const label = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })

export default function DispatchCalendar({ view, date, team, settings, filters, userName, laneColor, onOpenDay }: Props) {
  const [days, setDays] = useState<Record<string, RangeStop[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { from, to, cells } = useMemo(() => {
    if (view === 'week') {
      const f = weekStart(date)
      return { from: f, to: addDays(f, 6), cells: Array.from({ length: 7 }, (_, i) => addDays(f, i)) }
    }
    const first = `${date.slice(0, 7)}-01`
    const f = weekStart(first)
    const cells = Array.from({ length: 42 }, (_, i) => addDays(f, i))
    return { from: f, to: cells[41], cells }
  }, [view, date])

  const teamKey = team.join(',')
  useEffect(() => {
    if (!teamKey) { setDays({}); return }
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/hub/routing/dispatch/range?from=${from}&to=${to}&techIds=${encodeURIComponent(teamKey)}`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) throw new Error(d.error || 'Could not load')
        setDays(d.days ?? {})
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to, teamKey])

  const dim = (s: DispatchStop) => {
    if (filters.hideZero && Math.abs(s.totalPrice) < 0.005) return true
    const active = settings.filter_groups.filter(g => filters.groups.includes(g.id))
    return active.length > 0 && !active.some(g => stopMatchesGroup(s, g))
  }
  const today = todayLocal()
  const viewStart = hhmmToMinutes(settings.view_start)
  const span = Math.max(60, hhmmToMinutes(settings.view_end) - viewStart)

  if (team.length === 0) return null

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 overflow-x-auto">
      <div className="flex items-center gap-2 mb-2 text-sm">
        <span className="font-semibold">
          {view === 'week' ? `Week of ${label(from, { month: 'short', day: 'numeric' })}` : label(`${date.slice(0, 7)}-15`, { month: 'long', year: 'numeric' })}
        </span>
        {loading && <span className="text-xs text-gray-500">Loading…</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
        <span className="ml-auto text-[11px] text-gray-500">From Hub&apos;s copy of Jobber (visits only) · click a day to open it</span>
      </div>

      {view === 'week' ? (
        <div className="min-w-[760px]">
          <div className="grid" style={{ gridTemplateColumns: `8rem repeat(7, minmax(0, 1fr))` }}>
            <div />
            {cells.map(d => (
              <button key={d} type="button" onClick={() => onOpenDay(d)}
                className={`text-xs py-1 rounded hover:bg-gray-800 ${d === today ? 'text-orange-400 font-semibold' : 'text-gray-400'}`}>
                {label(d, { weekday: 'short', month: 'numeric', day: 'numeric' })}
              </button>
            ))}
            {team.map(t => (
              <WeekRow key={t} techId={t} cells={cells} days={days} name={userName(t)} color={laneColor(t)}
                settings={settings} dim={dim} viewStart={viewStart} span={span} onOpenDay={onOpenDay} />
            ))}
          </div>
        </div>
      ) : (
        <div className="min-w-[700px]">
          <div className="grid grid-cols-7 gap-px bg-gray-800 rounded-lg overflow-hidden">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <div key={w} className="bg-gray-900 text-[11px] text-gray-500 text-center py-1">{w}</div>)}
            {cells.map(d => {
              const list = (days[d] ?? []).filter(s => !dim(s))
              const inMonth = d.slice(0, 7) === date.slice(0, 7)
              return (
                <button key={d} type="button" onClick={() => onOpenDay(d)}
                  className={`bg-gray-900 hover:bg-gray-800 text-left p-1.5 min-h-[84px] align-top ${inMonth ? '' : 'opacity-40'}`}>
                  <div className={`text-xs mb-1 ${d === today ? 'text-orange-400 font-bold' : 'text-gray-400'}`}>{dayNum(d)}</div>
                  {team.map(t => {
                    const n = list.filter(s => s.techIds.includes(t)).length
                    return n ? (
                      <div key={t} className="flex items-center gap-1 text-[10px] text-gray-300">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: laneColor(t) }} />
                        <span className="truncate">{userName(t).split(' ')[0]}</span>
                        <span className="ml-auto text-gray-400">{n}</span>
                      </div>
                    ) : null
                  })}
                  {list.slice(0, 2).map(s => (
                    <div key={s.id} className="text-[10px] truncate mt-0.5 px-1 rounded text-[#fff]" style={{ background: stopColor(s, settings.color_rules, s.locked) }}>
                      {s.startMin != null ? `${fmtClock(s.startMin)} ` : ''}{s.clientName}
                    </div>
                  ))}
                  {list.length > 2 && <div className="text-[10px] text-gray-500">+{list.length - 2} more</div>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function WeekRow({ techId, cells, days, name, color, settings, dim, viewStart, span, onOpenDay }: {
  techId: string; cells: string[]; days: Record<string, RangeStop[]>; name: string; color: string
  settings: DispatchSettings; dim: (s: DispatchStop) => boolean; viewStart: number; span: number; onOpenDay: (d: string) => void
}) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium py-2 border-t border-gray-800 pr-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="truncate">{name}</span>
      </div>
      {cells.map(d => {
        const list = (days[d] ?? []).filter(s => s.techIds.includes(techId))
        const timed = list.filter(s => s.startMin != null)
        const anytime = list.length - timed.length
        return (
          <button key={d} type="button" onClick={() => onOpenDay(d)} className="border-t border-l border-gray-800 p-1 hover:bg-gray-800/60 text-left">
            <div className="relative h-5 rounded bg-gray-950/60 overflow-hidden">
              {timed.map(s => (
                <div key={s.id} className="absolute top-0.5 bottom-0.5 rounded-sm"
                  title={`${fmtClock(s.startMin!)} ${s.clientName}${s.locked ? ' · promised' : ''}`}
                  style={{
                    left: `${Math.max(0, ((s.startMin! - viewStart) / span) * 100)}%`,
                    width: `${Math.max(3, (((s.endMin ?? s.startMin! + 30) - s.startMin!) / span) * 100)}%`,
                    background: stopColor(s, settings.color_rules, s.locked),
                    opacity: dim(s) ? 0.25 : s.isComplete ? 0.5 : 1,
                  }} />
              ))}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {list.length ? `${list.length} stop${list.length === 1 ? '' : 's'}` : '—'}{anytime ? ` · ${anytime} anytime` : ''}
            </div>
          </button>
        )
      })}
    </>
  )
}
