'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'
import Link from 'next/link'

type ChemicalApplied = {
  matched_line_item?: string
  chemical_name?: string
  epa_registration_number?: string | null
  active_ingredients?: string | null
  target_pests?: string | null
  application_rate?: string | null
}

type WeatherSnap = {
  temperature_f?: number | null
  conditions?: string | null
  wind_mph?: number | null
  humidity_pct?: number | null
} | null

type PesticideRecord = {
  id: string
  application_timestamp: string
  location_address: string | null
  customer_name: string | null
  technician_name: string | null
  jobber_visit_id: string | null
  chemicals_applied: ChemicalApplied[] | null
  weather: WeatherSnap
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateOffset(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago',
  })
}

export default function PesticideRecordsView() {
  // Default to last 30 days. Records older than the window stay accessible
  // via a direct date filter or the CSV export.
  const [from, setFrom] = useState<string>(dateOffset(todayStr(), -30))
  const [to, setTo] = useState<string>(todayStr())
  const [q, setQ] = useState<string>('')
  const [records, setRecords] = useState<PesticideRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (q.trim()) params.set('q', q.trim())
      params.set('limit', '500')
      const res = await fetch(`/api/hub/pesticide-records?${params}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`)
      setRecords(body.records ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [from, to, q])

  useEffect(() => {
    load()
  }, [load])

  const exportHref = (() => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return `/api/hub/pesticide-records/export?${params}`
  })()

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none px-3 md:px-6 pt-4 pb-3 border-b border-gray-800 max-md:pl-14">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h1 className="text-xl md:text-2xl font-semibold text-white">Pesticide Records</h1>
            <a
              href={exportHref}
              className="text-xs md:text-sm px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
              title="Download visible records as CSV (TDA compliance format)"
            >
              ⬇ Export CSV
            </a>
          </div>
          <p className="text-xs md:text-sm text-gray-400 hidden md:block">
            Auto-generated from Daily Log v2 when stops with chemical line items are marked complete. One row per application; the CSV expands to one row per chemical applied. Records are preserved across stop reopen.
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">From</label>
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-base md:text-sm text-white"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">To</label>
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-base md:text-sm text-white"
              />
            </div>
            <input
              type="text"
              placeholder="Search customer, address, or technician…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="flex-1 min-w-[180px] bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-base md:text-sm text-white placeholder-gray-500"
            />
            <button
              onClick={() => {
                setFrom(dateOffset(todayStr(), -30))
                setTo(todayStr())
                setQ('')
              }}
              className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-6xl mx-auto px-3 md:px-6 py-4 pb-24">
          {loading && <div className="py-12 text-center"><Spinner size={6} /></div>}
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm mb-4">
              {error}
            </div>
          )}
          {!loading && !error && records.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 md:p-8 text-center">
              <p className="text-gray-400 mb-2">No pesticide records in this range.</p>
              <p className="text-sm text-gray-500">
                Records are created automatically when a visit is completed — either by marking a stop complete in <Link href="/hub/daily-log-v2" className="text-sky-400 hover:underline">Daily Log v2</Link> or when Jobber reports the visit complete — and any of its line items match a product in <Link href="/hub/admin/service-mapping" className="text-sky-400 hover:underline">Admin → Service Mapping</Link>.
              </p>
            </div>
          )}

          {records.length > 0 && (
            <div className="space-y-2">
              {records.map(r => (
                <RecordCard key={r.id} record={r} />
              ))}
            </div>
          )}

          {records.length > 0 && (
            <div className="text-xs text-gray-500 text-center mt-6">
              Showing {records.length} record{records.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RecordCard({ record: r }: { record: PesticideRecord }) {
  const chemicals = Array.isArray(r.chemicals_applied) ? r.chemicals_applied : []

  return (
    <Link
      href={`/hub/pesticide-records/${r.id}`}
      className="block bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:bg-gray-800/60 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-medium text-white">{r.customer_name ?? 'Unknown customer'}</div>
            <div className="text-xs text-gray-400">{formatDateTime(r.application_timestamp)}</div>
          </div>
          <div className="text-sm text-gray-400 truncate mt-0.5">{r.location_address ?? '—'}</div>
          {r.technician_name && (
            <div className="text-xs text-gray-500 mt-0.5">Applied by {r.technician_name}</div>
          )}
        </div>
        <div className="flex-none">
          {r.weather && (
            <div className="text-xs text-gray-400 text-right">
              {typeof r.weather.temperature_f === 'number' && `${r.weather.temperature_f}°F`}
              {r.weather.conditions && (
                <div className="text-[10px] text-gray-500">{r.weather.conditions}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {chemicals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chemicals.map((c, i) => (
            <span
              key={i}
              className="text-[11px] bg-emerald-500/15 text-emerald-200 px-2 py-0.5 rounded"
              title={c.epa_registration_number ? `EPA ${c.epa_registration_number}` : undefined}
            >
              🧪 {c.chemical_name}
              {c.epa_registration_number && ` · ${c.epa_registration_number}`}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}
