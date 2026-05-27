'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import RoutePreviewMap, { type RoutePreviewPin } from '@/components/RoutePreviewMap'

type HubUser = { id: string; display_name: string; avatar_url?: string | null }

type LineItem = {
  name: string
  qty: number
  unitPrice: number
  totalPrice: number
}

type Stop = {
  id: string
  ord: number
  jobber_visit_id: string | null
  client_name: string
  client_phone: string | null
  address: string
  lat: number | null
  lng: number | null
  job_title: string | null
  line_items: LineItem[]
  instructions: string | null
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  duration_minutes: number | null
  status: 'pending' | 'in_progress' | 'complete' | 'skipped'
  completed_at: string | null
  notes: string | null
}

type Entry = {
  id: string
  log_date: string
  office_notes: string | null
  route_sheet_url: string | null
  route_sheet_name: string | null
  completed_at: string | null
  closed_at: string | null
  tech: HubUser | null
  stops: Stop[]
  secondary_techs: HubUser[]
}

type ApiResponse = {
  entries: Entry[]
  depot: { lat: number; lng: number } | null
}

function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function offsetDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDateHeading(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function pinLabel(ord: number): string {
  return ord <= 9 ? String(ord) : String.fromCharCode(97 + (ord - 10))
}

function UserAvatar({ user, size = 8 }: { user: HubUser | null; size?: number }) {
  if (!user) return null
  const initials = user.display_name.split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const px = size * 4
  return (
    <div
      style={{ width: px, height: px }}
      className="rounded-full bg-[#2E7EB8] flex items-center justify-center text-white font-semibold text-xs flex-none"
    >
      {initials}
    </div>
  )
}

export default function DailyLogV2View({
  currentUserId,
  isAdmin,
}: {
  currentUserId: string
  isAdmin: boolean
}) {
  const [date, setDate] = useState<string>(todayStr())
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [entries, setEntries] = useState<Entry[]>([])
  const [depot, setDepot] = useState<{ lat: number; lng: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hub/daily-log-v2?date=${d}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed (${res.status})`)
      }
      const data = (await res.json()) as ApiResponse
      setEntries(data.entries ?? [])
      setDepot(data.depot ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  const visibleEntries = useMemo(() => {
    if (filter === 'all') return entries
    return entries.filter(e =>
      e.tech?.id === currentUserId ||
      e.secondary_techs.some(t => t.id === currentUserId),
    )
  }, [entries, filter, currentUserId])

  return (
    <div className="flex flex-col h-full">
      {/* Header — stays fixed at top while content scrolls below */}
      <header className="flex-none px-3 md:px-6 pt-4 pb-3 border-b border-gray-800">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-xl md:text-2xl font-semibold text-white">Daily Log v2</h1>
            <span className="text-[10px] md:text-xs bg-violet-500/20 text-violet-200 px-2 py-0.5 rounded">Preview</span>
          </div>
          <p className="text-xs md:text-sm text-gray-400 hidden md:block">
            Tech-facing view of each day&apos;s stops. Populated by the Route Optimizer&apos;s <strong>Send to Daily Log</strong> button.
          </p>

          {/* Date + filter row */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setDate(offsetDate(date, -1))}
                className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white min-w-[40px]"
                title="Previous day"
              >
                ←
              </button>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 md:py-1.5 text-base md:text-sm text-white"
              />
              <button
                onClick={() => setDate(offsetDate(date, 1))}
                className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white min-w-[40px]"
                title="Next day"
              >
                →
              </button>
              {date !== todayStr() && (
                <button
                  onClick={() => setDate(todayStr())}
                  className="px-3 py-2 md:py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-white"
                >
                  Today
                </button>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1 bg-gray-800 border border-gray-700 rounded p-0.5">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 md:py-1 rounded text-sm ${filter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('mine')}
                className={`px-3 py-1.5 md:py-1 rounded text-sm ${filter === 'mine' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                My Day
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-400 mt-2">
            {formatDateHeading(date)}
          </div>
        </div>
      </header>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-5xl mx-auto px-3 md:px-6 py-4 pb-24">
          {loading && <div className="text-gray-500 text-sm">Loading…</div>}
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm mb-4">
              {error}
            </div>
          )}

          {!loading && !error && visibleEntries.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 md:p-8 text-center">
              <p className="text-gray-400 mb-2">No entries for {formatDateHeading(date)}.</p>
              <p className="text-sm text-gray-500">
                Run the <a href="/hub/routing" className="text-sky-400 hover:underline">Route Optimizer</a> and click
                {' '}<strong>Send to Daily Log</strong> to populate stops here.
              </p>
            </div>
          )}

          <div className="space-y-4 md:space-y-6">
            {visibleEntries.map(entry => (
              <EntryCard
                key={entry.id}
                entry={entry}
                depot={depot}
                isAdmin={isAdmin}
                mapHeight={isMobile ? 240 : 360}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function EntryCard({
  entry,
  depot,
  isAdmin,
  mapHeight,
}: {
  entry: Entry
  depot: { lat: number; lng: number } | null
  isAdmin: boolean
  mapHeight: number
}) {
  const stopsWithCoords = entry.stops.filter(s => s.lat != null && s.lng != null)
  const hasMap = stopsWithCoords.length > 0

  const pins: RoutePreviewPin[] = stopsWithCoords.map(s => ({
    id: s.id,
    lat: s.lat!,
    lng: s.lng!,
    label: pinLabel(s.ord),
    color: s.status === 'complete' ? '888888' : 'c0392b',
    title: `${s.ord}. ${s.client_name}`,
  }))

  const isCompleted = entry.completed_at != null
  const isClosed = entry.closed_at != null

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden ${isClosed ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <UserAvatar user={entry.tech} />
          <div className="min-w-0">
            <div className="font-semibold text-white truncate">
              {entry.tech?.display_name ?? 'Unknown tech'}
            </div>
            {entry.secondary_techs.length > 0 && (
              <div className="text-xs text-gray-400 truncate">
                + {entry.secondary_techs.map(t => t.display_name).join(', ')}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {isCompleted && (
            <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded">
              ✓ Route Completed
            </span>
          )}
          {isClosed && (
            <span className="text-xs bg-sky-500/20 text-sky-300 px-2 py-1 rounded">
              Closed
            </span>
          )}
        </div>
      </div>

      {/* Office instructions */}
      {entry.office_notes && (
        <div className="px-5 py-3 bg-amber-500/5 border-b border-gray-800">
          <div className="text-xs font-medium text-amber-300 mb-1">Office Instructions</div>
          <div className="text-sm text-gray-200 whitespace-pre-wrap">{entry.office_notes}</div>
        </div>
      )}

      {/* Map */}
      {hasMap && (
        <div className="border-b border-gray-800">
          <RoutePreviewMap
            depotCoord={depot}
            pins={pins}
            drawDrivePath={true}
            height={mapHeight}
          />
        </div>
      )}

      {/* Stops list */}
      <div className="divide-y divide-gray-800">
        {entry.stops.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-500 text-center">
            No stops attached yet. Send a route from the Route Optimizer to populate.
          </div>
        ) : (
          entry.stops.map(s => <StopRow key={s.id} stop={s} />)
        )}
      </div>

      {/* Route sheet link if uploaded */}
      {entry.route_sheet_url && (
        <div className="px-5 py-3 bg-gray-900/50 border-t border-gray-800 text-xs">
          <a
            href={entry.route_sheet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 hover:underline"
          >
            📎 {entry.route_sheet_name ?? 'Route Sheet'}
          </a>
        </div>
      )}

      {isAdmin && (
        <div className="px-5 py-2 bg-gray-900/30 border-t border-gray-800 text-[10px] text-gray-600 uppercase tracking-wide">
          Phase 1 preview — tech actions (complete, navigate, on-my-way SMS, notes) ship in Phase 2+
        </div>
      )}
    </div>
  )
}

function StopRow({ stop }: { stop: Stop }) {
  const lineItemNames = stop.line_items.map(li => li.name).filter(Boolean)
  const lineItemsSummary = lineItemNames.length === 0
    ? null
    : lineItemNames.length <= 2
      ? lineItemNames.join(' · ')
      : `${lineItemNames.slice(0, 2).join(' · ')} +${lineItemNames.length - 2} more`

  const statusColor =
    stop.status === 'complete' ? 'bg-emerald-500/20 text-emerald-300' :
    stop.status === 'in_progress' ? 'bg-amber-500/20 text-amber-300' :
    stop.status === 'skipped' ? 'bg-gray-500/20 text-gray-400' :
    'bg-gray-800 text-gray-400'

  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <div
        className={`w-8 h-8 rounded-full flex-none flex items-center justify-center text-sm font-semibold ${
          stop.status === 'complete' ? 'bg-gray-700 text-gray-400' : 'bg-red-900/40 text-red-300'
        }`}
      >
        {pinLabel(stop.ord)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-medium text-white">{stop.client_name}</div>
          {stop.scheduled_start_at && (
            <div className="text-xs text-gray-400">{formatTime(stop.scheduled_start_at)}</div>
          )}
          {stop.duration_minutes && (
            <div className="text-xs text-gray-500">~{stop.duration_minutes} min</div>
          )}
          {stop.status !== 'pending' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${statusColor}`}>
              {stop.status}
            </span>
          )}
        </div>
        <div className="text-sm text-gray-400 truncate">{stop.address}</div>
        {stop.job_title && (
          <div className="text-xs text-gray-500 mt-0.5">{stop.job_title}</div>
        )}
        {lineItemsSummary && (
          <div className="text-xs text-gray-500 mt-0.5">{lineItemsSummary}</div>
        )}
        {stop.instructions && (
          <div className="text-xs text-amber-300/80 mt-1 italic">
            Note: {stop.instructions}
          </div>
        )}
      </div>
    </div>
  )
}
