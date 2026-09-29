'use client'

// Admin → AI → Knowledge → Neighborhood map. Upload the company's Google My Maps
// export (KML or KMZ); both Ambers then read it — the Hub assistant's
// lookup_neighborhood action and the phone receptionist's direct-booking job
// titles. Self-fetching like SchedulingPanel. An upload saves immediately (it
// replaces the whole map), and the test box checks one address against it.

import { useEffect, useRef, useState } from 'react'

type MapSummary = { names: string[]; fileName: string | null; uploadedAt: string | null }

type LookupResult =
  | { status: 'no_map' }
  | { status: 'not_geocoded' }
  | {
      status: 'found' | 'outside' | 'overlap'
      matches: string[]
      nearBorder: string[]
      nearest: { name: string; metres: number } | null
    }

function describe(r: LookupResult): string {
  if (r.status === 'no_map') return 'No map uploaded yet.'
  if (r.status === 'not_geocoded') return 'Couldn’t place that address to a specific house — check the house number and zip.'
  const border = r.nearBorder.length ? ` (close to the ${r.nearBorder.join(' / ')} border)` : ''
  if (r.status === 'found') return `In ${r.matches[0]}${border}.`
  if (r.status === 'overlap') return `Inside two overlapping areas: ${r.matches.join(' and ')}.`
  return `Outside every neighborhood on the map${r.nearest ? ` — closest is ${r.nearest.name}, ${(r.nearest.metres / 1609.34).toFixed(1)} mi away` : ''}.`
}

export default function NeighborhoodMapPanel() {
  const [map, setMap] = useState<MapSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [testAddress, setTestAddress] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/neighborhood-map')
        const json = await res.json()
        if (!cancelled) {
          if (!res.ok) setError(json.error || 'Could not load the map.')
          else setMap(json.map)
        }
      } catch {
        if (!cancelled) setError('Could not load the map.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    setNotice(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/neighborhood-map', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) setError(json.error || 'Upload failed.')
      else {
        setMap(json.map)
        setNotice(`Saved — ${json.map.names.length} neighborhoods loaded.`)
      }
    } catch {
      setError('Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const runTest = async () => {
    if (!testAddress.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/neighborhood-map', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: testAddress }),
      })
      const json = await res.json()
      setTestResult(res.ok ? describe(json.result) : json.error || 'Lookup failed.')
    } catch {
      setTestResult('Lookup failed.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="border border-white/10 rounded-lg p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Neighborhood map</h2>
        <p className="text-xs text-white/50 mt-0.5">
          Your neighborhoods, drawn as shapes in Google My Maps. Amber uses this map to say which neighborhood an address
          is in, and the AI receptionist uses it to fill in the neighborhood on a job it books when the customer&apos;s
          earlier jobs don&apos;t name one. She only goes by where the house falls on the map — never by zip code or
          city.
        </p>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/60 leading-relaxed">
        To export: open the map in Google My Maps → the <strong>⋮</strong> menu → <strong>Export to KML/KMZ</strong> →
        pick the layer with your neighborhood shapes → Download. Upload that file here. Uploading again replaces the
        whole map.
      </div>

      {loading ? (
        <p className="text-xs text-white/40">Loading…</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border border-white/10 rounded-lg p-3">
            <div className="min-w-0">
              {map ? (
                <>
                  <p className="text-sm font-medium text-white">{map.names.length} neighborhoods</p>
                  <p className="text-xs text-white/50 mt-0.5 truncate">
                    {map.fileName || 'Uploaded map'}
                    {map.uploadedAt ? ` · uploaded ${new Date(map.uploadedAt).toLocaleDateString()}` : ''}
                  </p>
                </>
              ) : (
                <p className="text-sm text-white/60">No map uploaded yet.</p>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload(f)
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 bg-brand hover:opacity-90 disabled:opacity-50 rounded-lg text-xs font-medium text-white whitespace-nowrap"
            >
              {uploading ? 'Uploading…' : map ? 'Replace map' : 'Upload map'}
            </button>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {notice && <p className="text-xs text-green-400">{notice}</p>}

          {map && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {map.names.map((n) => (
                  <span key={n} className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/70">
                    {n}
                  </span>
                ))}
              </div>

              <div className="border border-white/10 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-white">Test an address</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testAddress}
                    onChange={(e) => setTestAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') runTest()
                    }}
                    placeholder="123 Main St, The Woodlands, TX 77380"
                    className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
                  />
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={testing || !testAddress.trim()}
                    className="px-3 py-1.5 border border-white/15 hover:border-white/30 disabled:opacity-50 rounded-lg text-xs font-medium text-white/80 whitespace-nowrap"
                  >
                    {testing ? 'Checking…' : 'Check'}
                  </button>
                </div>
                {testResult && <p className="text-xs text-white/70">{testResult}</p>}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
