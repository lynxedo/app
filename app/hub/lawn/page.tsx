'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'

type Confidence = 'HIGH' | 'MEDIUM' | 'FLAG'

interface EstimateResult {
  address: string
  lat: number
  lon: number
  parcel_source: string
  parcel_apn: string | null
  lot_sqft: number
  building_sqft: number
  drive_sqft: number
  visible_lawn_sqft: number
  canopy_sqft: number
  canopy_pct: number
  pool_present: boolean
  bare_soil_pct: number
  hardscape_suspected: boolean
  adjusted_lawn_sqft: number | null
  multiplier: string | null
  confidence: Confidence
  flag_reason: string | null
  tile_url: string
  runtime_ms: number
  mode: string
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

function fmt(n: number | null | undefined) {
  if (!n || n <= 0) return '—'
  return n.toLocaleString() + ' sq ft'
}

function confLabel(c: Confidence) {
  if (c === 'HIGH') return '✅ HIGH confidence'
  if (c === 'MEDIUM') return '⚠️ MEDIUM confidence'
  return '🚩 FLAG — verify on first visit'
}

function confBg(c: Confidence) {
  if (c === 'HIGH') return 'bg-green-900/30 border-green-700'
  if (c === 'MEDIUM') return 'bg-yellow-900/30 border-yellow-700'
  return 'bg-red-900/30 border-red-700'
}

function confText(c: Confidence) {
  if (c === 'HIGH') return 'text-green-300'
  if (c === 'MEDIUM') return 'text-yellow-300'
  return 'text-red-300'
}

function confBigNum(c: Confidence) {
  if (c === 'HIGH') return 'text-green-400'
  if (c === 'MEDIUM') return 'text-yellow-400'
  return 'text-red-400'
}

function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-gray-400">
      <div className="w-8 h-8 border-2 border-gray-700 border-t-green-500 rounded-full animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  )
}

function ResultCard({ result, label }: { result: EstimateResult; label?: string }) {
  const c = result.confidence
  return (
    <div className={`rounded-xl border p-5 ${confBg(c)}`}>
      {label && (
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{label}</p>
      )}
      <div className={`text-5xl font-extrabold leading-none mb-1 ${confBigNum(c)}`}>
        {result.adjusted_lawn_sqft != null ? result.adjusted_lawn_sqft.toLocaleString() : '—'}
      </div>
      <div className="text-sm text-gray-400 mb-3">sq ft estimated lawn</div>
      <div className={`text-sm font-semibold ${confText(c)}`}>{confLabel(c)}</div>
    </div>
  )
}

function Details({ result }: { result: EstimateResult }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="text-sm font-semibold text-white mb-1">{result.address}</div>
      <div className="text-xs text-gray-500 mb-4">
        APN: {result.parcel_apn || '—'} ({result.parcel_source}) · {result.lat}, {result.lon}
      </div>

      <DetailRow label="Lot size" value={fmt(result.lot_sqft)} />
      <DetailRow label="Building footprint" value={fmt(result.building_sqft)} />
      <DetailRow label="Driveway" value={fmt(result.drive_sqft)} />
      <DetailRow label="Visible lawn" value={fmt(result.visible_lawn_sqft)} />
      <DetailRow
        label="Canopy on lot"
        value={fmt(result.canopy_sqft) + (result.canopy_pct ? ` (${result.canopy_pct}%)` : '')}
      />
      <DetailRow label="Pool detected" value={result.pool_present ? 'Yes' : 'No'} />
      <DetailRow label="Bare soil" value={result.bare_soil_pct != null ? `${result.bare_soil_pct}%` : '—'} />
      <DetailRow
        label="Canopy rule"
        value={result.canopy_pct != null ? `${result.canopy_pct}% → ×${result.multiplier || '—'}` : '—'}
      />
      <DetailRow label="Data source" value={result.parcel_source} />

      {result.flag_reason && (
        <div className={`mt-4 rounded-lg px-4 py-3 text-sm border ${
          result.confidence === 'FLAG'
            ? 'bg-red-900/30 border-red-800 text-red-300'
            : 'bg-yellow-900/30 border-yellow-800 text-yellow-300'
        }`}>
          {result.flag_reason}
        </div>
      )}

      {result.tile_url && (
        <a
          href={result.tile_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block text-center text-sm font-medium text-green-400 hover:text-green-300 border border-green-800 rounded-lg py-2 transition-colors"
        >
          View Satellite Image ↗
        </a>
      )}

      <div className="mt-3 text-center text-xs text-gray-600">
        {result.mode} · {result.runtime_ms}ms
      </div>
    </div>
  )
}

function AddressInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled: boolean
}) {
  const [suggestions, setSuggestions] = useState<{ place_name: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 4) { setSuggestions([]); return }
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&country=US&types=address&limit=5`
      const res = await fetch(url)
      const data = await res.json()
      setSuggestions(data.features ?? [])
    } catch {
      setSuggestions([])
    }
  }, [])

  function handleChange(v: string) {
    onChange(v)
    setShowSuggestions(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 300)
  }

  function pickSuggestion(place: string) {
    onChange(place)
    setSuggestions([])
    setShowSuggestions(false)
    setTimeout(onSubmit, 0)
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <input
        type="text"
        value={value}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !disabled) { setShowSuggestions(false); onSubmit() }
          if (e.key === 'Escape') setShowSuggestions(false)
        }}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        placeholder="e.g. 221 Galloway Ct, The Woodlands TX 77382"
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors"
      />
      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={() => pickSuggestion(s.place_name)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 transition-colors truncate"
              >
                {s.place_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function LawnPage() {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState('')
  const [quickResult, setQuickResult] = useState<EstimateResult | null>(null)
  const [advResult, setAdvResult] = useState<EstimateResult | null>(null)
  const [advLoading, setAdvLoading] = useState(false)

  async function fetchEstimate(addr: string, mode: 'quick' | 'advanced'): Promise<EstimateResult> {
    const res = await fetch('/api/lawn/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, mode }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || data.error || 'Server error')
    return data
  }

  async function run() {
    const addr = address.trim()
    if (!addr) return

    setLoading(true)
    setLoadingLabel('Analyzing satellite imagery…')
    setError('')
    setQuickResult(null)
    setAdvResult(null)
    setAdvLoading(false)

    try {
      const quick = await fetchEstimate(addr, 'quick')
      setQuickResult(quick)
      setLoading(false)

      if (quick.confidence === 'HIGH') return

      setAdvLoading(true)
      const adv = await fetchEstimate(addr, 'advanced')
      setAdvResult(adv)
      setAdvLoading(false)
    } catch (e: unknown) {
      setLoading(false)
      setAdvLoading(false)
      setError(e instanceof Error ? e.message : 'Unknown error — please try again.')
    }
  }

  function reset() {
    setQuickResult(null)
    setAdvResult(null)
    setError('')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-2 max-md:pl-14">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Lawn Sizer</h1>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-5">
        {/* Search */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <label className="block text-sm font-medium text-gray-300 mb-3">Property Address</label>
          <div className="flex gap-3">
            <AddressInput
              value={address}
              onChange={setAddress}
              onSubmit={run}
              disabled={loading}
            />
            <button
              onClick={loading ? undefined : run}
              disabled={loading || !address.trim()}
              className="px-5 py-2.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-[#fff] font-medium rounded-lg text-sm transition-colors whitespace-nowrap"
            >
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-600">
            Uses satellite imagery + AI vision to estimate mowable lawn square footage.
          </p>
        </div>

        {/* Loading */}
        {loading && <Spinner label={loadingLabel} />}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Quick result — HIGH confidence */}
        {quickResult && quickResult.confidence === 'HIGH' && !loading && (
          <>
            <ResultCard result={quickResult} />
            <Details result={quickResult} />
            <button onClick={reset} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
              ← New search
            </button>
          </>
        )}

        {/* Quick result — not HIGH */}
        {quickResult && quickResult.confidence !== 'HIGH' && !loading && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <ResultCard result={quickResult} label="Quick (1-run)" />
              {advLoading && (
                <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 flex flex-col items-center justify-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Advanced (3-run)</p>
                  <div className="w-6 h-6 border-2 border-gray-700 border-t-green-500 rounded-full animate-spin mt-2" />
                  <p className="text-xs text-gray-600 mt-1">Refining…</p>
                </div>
              )}
              {advResult && <ResultCard result={advResult} label="Advanced (3-run)" />}
            </div>

            {advLoading && (
              <div className="flex items-center gap-2 text-xs text-green-400 bg-green-900/20 border border-green-900 rounded-lg px-4 py-2.5">
                <div className="w-3 h-3 border border-green-700 border-t-green-400 rounded-full animate-spin flex-shrink-0" />
                Confidence below HIGH — running 3-pass analysis to improve accuracy…
              </div>
            )}

            <Details result={advResult ?? quickResult} />
            {!advLoading && (
              <button onClick={reset} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                ← New search
              </button>
            )}
          </>
        )}
      </main>
    </div>
  )
}
