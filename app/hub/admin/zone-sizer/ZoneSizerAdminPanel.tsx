'use client'

import { useState } from 'react'

type Settings = {
  turf_sqft_per_zone: number
  bed_sqft_per_zone: number
}

export default function ZoneSizerAdminPanel({ initial }: { initial: Settings }) {
  const [s, setS] = useState<Settings>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/zone-sizer-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Save failed (${res.status})`)
      }
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function setNum<K extends keyof Settings>(key: K, raw: string) {
    const v = parseInt(raw, 10)
    setS((prev) => ({ ...prev, [key]: (Number.isFinite(v) && v > 0 ? v : prev[key]) as Settings[K] }))
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Zone Sizer</h1>
          <p className="text-sm text-white/60 mt-1">
            Configure the conversion rates Zone Sizer uses when computing irrigation zone counts from
            satellite-detected turf and landscape bed areas.
          </p>
        </header>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
          <h2 className="font-semibold">Square feet per zone</h2>

          <NumberField
            label="Turf (lawn) zones"
            value={s.turf_sqft_per_zone}
            suffix="sq ft per zone"
            min={100}
            max={10000}
            onChange={(v) => setNum('turf_sqft_per_zone', v)}
            help="Default 1,000 sq ft per zone for rotors covering grass area."
          />
          <NumberField
            label="Bed (landscape) zones"
            value={s.bed_sqft_per_zone}
            suffix="sq ft per zone"
            min={100}
            max={10000}
            onChange={(v) => setNum('bed_sqft_per_zone', v)}
            help="Default 1,000 sq ft per zone. Raise this if you use drip / microspray that covers more area per zone."
          />
        </section>

        {error && (
          <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded bg-[#2E7EB8] hover:bg-[#3a8dc9] disabled:opacity-50 text-sm font-medium"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedAt && !error && (
            <span className="text-xs text-emerald-300">Saved ✓</span>
          )}
        </div>
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
  help,
}: {
  label: string
  value: number
  suffix: string
  min: number
  max: number
  onChange: (raw: string) => void
  help?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-28"
        />
        <span className="text-sm text-white/60">{suffix}</span>
      </div>
      {help && <p className="text-xs text-white/40 mt-1">{help}</p>}
    </div>
  )
}
