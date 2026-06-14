'use client'

import { useState } from 'react'

type EstimateResponse = {
  address: string
  lat?: number
  lon?: number
  tile_url?: string
  turf_sqft: number
  bed_sqft: number
  lawn_zones: number
  bed_zones: number
  turf_sqft_per_zone: number
  bed_sqft_per_zone: number
  confidence: 'HIGH' | 'MEDIUM' | 'FLAG' | null
  flag_reason: string | null
  canopy_pct: number
  parcel_source: string
  lot_sqft: number
  runtime_ms: number | null
}

export default function ZoneSizerPanel({
  turfSqftPerZone,
  bedSqftPerZone,
}: {
  turfSqftPerZone: number
  bedSqftPerZone: number
}) {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EstimateResponse | null>(null)
  const [bedOverride, setBedOverride] = useState<number | null>(null)

  async function runEstimate() {
    const trimmed = address.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setResult(null)
    setBedOverride(null)
    try {
      const res = await fetch('/api/hub/zone-sizer/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: trimmed }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`)
      setResult(body as EstimateResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const effectiveBedSqft = bedOverride ?? result?.bed_sqft ?? 0
  const effectiveBedZones = effectiveBedSqft > 0 ? Math.ceil(effectiveBedSqft / bedSqftPerZone) : 0
  const totalZones = (result?.lawn_zones ?? 0) + effectiveBedZones

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Zone Sizer</h1>
          <p className="text-sm text-white/60 mt-1">
            Estimate irrigation zone count for a residential property.
            {' '}1 zone per {turfSqftPerZone.toLocaleString()} sq ft of turf and {bedSqftPerZone.toLocaleString()} sq ft of beds.
          </p>
        </header>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <label className="block text-sm font-medium">Address</label>
          <div className="flex flex-col md:flex-row gap-2">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) runEstimate()
              }}
              placeholder="123 Main St, The Woodlands, TX"
              className="flex-1 bg-gray-900 border border-white/15 rounded px-3 py-2 text-base md:text-sm outline-none focus:border-brand"
              autoFocus
            />
            <button
              onClick={runEstimate}
              disabled={loading || !address.trim()}
              className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
            >
              {loading ? 'Sizing…' : 'Estimate zones'}
            </button>
          </div>
          <p className="text-xs text-white/40">
            Always runs the 3-call advanced average. Expect 15–30 seconds per estimate.
          </p>
        </section>

        {error && (
          <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-6 text-sm text-white/60 text-center">
            Analyzing satellite imagery and computing zones…
          </div>
        )}

        {result && !loading && (
          <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-base">{result.address}</h2>
                <p className="text-xs text-white/40 mt-0.5">
                  {result.parcel_source !== 'none' && `${result.parcel_source} parcel · `}
                  {result.lot_sqft > 0 && `${result.lot_sqft.toLocaleString()} sq ft lot · `}
                  {Math.round((result.runtime_ms ?? 0) / 1000)}s
                </p>
              </div>
              <ConfidenceBadge confidence={result.confidence} />
            </div>

            {result.flag_reason && (
              <div className="rounded border border-amber-700 bg-amber-900/20 text-amber-200 px-3 py-2 text-xs">
                {result.flag_reason}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Metric
                label="Turf"
                primary={`${result.turf_sqft.toLocaleString()} sq ft`}
                secondary={`${result.lawn_zones} lawn zone${result.lawn_zones === 1 ? '' : 's'}`}
              />
              <Metric
                label="Beds"
                primary={
                  <BedInput
                    value={effectiveBedSqft}
                    autoValue={result.bed_sqft}
                    onChange={(v) => setBedOverride(v === result.bed_sqft ? null : v)}
                  />
                }
                secondary={`${effectiveBedZones} bed zone${effectiveBedZones === 1 ? '' : 's'}`}
                note={bedOverride !== null ? `Auto-detected: ${result.bed_sqft.toLocaleString()} sq ft` : 'Auto-detected — tap to edit'}
              />
            </div>

            <div className="rounded-lg bg-brand/15 border border-brand/40 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-white/80">Total zones</span>
              <span className="text-2xl font-semibold">{totalZones}</span>
            </div>

            {result.tile_url && (
              <details className="text-xs text-white/40">
                <summary className="cursor-pointer hover:text-white/70 select-none">Satellite reference</summary>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.tile_url} alt="Satellite reference" className="mt-2 rounded border border-white/10 w-full" />
              </details>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: EstimateResponse['confidence'] }) {
  if (!confidence) return null
  const color =
    confidence === 'HIGH'
      ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700'
      : confidence === 'MEDIUM'
      ? 'bg-amber-900/40 text-amber-200 border-amber-700'
      : 'bg-red-900/40 text-red-200 border-red-700'
  return (
    <span className={`text-[11px] uppercase tracking-wide font-semibold px-2 py-1 rounded border ${color}`}>
      {confidence}
    </span>
  )
}

function Metric({
  label,
  primary,
  secondary,
  note,
}: {
  label: string
  primary: React.ReactNode
  secondary: string
  note?: string
}) {
  return (
    <div className="rounded border border-white/10 bg-gray-900/40 px-3 py-3">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-base font-medium">{primary}</div>
      <div className="mt-0.5 text-sm text-white/60">{secondary}</div>
      {note && <div className="mt-1 text-[11px] text-white/30">{note}</div>}
    </div>
  )
}

function BedInput({
  value,
  autoValue,
  onChange,
}: {
  value: number
  autoValue: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isFinite(n) && n >= 0 ? n : 0)
        }}
        className="w-28 bg-gray-900 border border-white/15 rounded px-2 py-1 text-base font-medium outline-none focus:border-brand"
      />
      <span className="text-sm text-white/60">sq ft</span>
      {value !== autoValue && (
        <button
          onClick={() => onChange(autoValue)}
          className="text-[11px] text-brand hover:text-white"
          title="Reset to auto-detected value"
        >
          reset
        </button>
      )}
    </div>
  )
}
