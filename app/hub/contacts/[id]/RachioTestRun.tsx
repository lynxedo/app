'use client'

// Quick run of the customer's Rachio zones, INLINE under "Edit zones by voice"
// (Ben, Oct 8 2026: "this is only valuable if, at the same time, we can be
// filling out the inspection report and editing zones by voice … just a button
// to start the quick run, to go to the next zone, and to stop … underneath the
// Start Talking box but before the zone cards"). Each zone runs 2 minutes, one
// after another. Every start carries its own 2-minute limit, so the controller
// shuts the zone off by itself even if the phone loses signal; closing the
// inspection stops the water.

import { useCallback, useEffect, useRef, useState } from 'react'

type Zone = { id: string; number: number; name: string }

export default function RachioTestRun({ contactId, inspectionId, deviceId }: {
  contactId: string
  inspectionId: string
  /** The customer's controller — null until Import from Rachio picked one. */
  deviceId: string | null
}) {
  const base = `/api/hub/contacts/${contactId}/irrigation/${inspectionId}/rachio/run`
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [seconds, setSeconds] = useState(120)
  const [err, setErr] = useState<string | null>(null)
  const [current, setCurrent] = useState<number | null>(null) // index into zones while running
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  const runningRef = useRef(false)
  const wake = useRef<{ release: () => Promise<void> } | null>(null)

  // A different controller picked → start over.
  useEffect(() => { setZones(null) }, [deviceId])

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, ...body }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || 'Rachio didn’t respond')
    return j
  }, [base, deviceId])

  const runZone = useCallback(async (list: Zone[], i: number) => {
    if (i >= list.length) return
    setBusy(true); setErr(null)
    try {
      await post({ action: 'zone', zoneId: list[i].id })
      setCurrent(i); setEndsAt(Date.now() + seconds * 1000); setNow(Date.now())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the zone')
    } finally { setBusy(false) }
  }, [post, seconds])

  const stopAll = useCallback(async (finishedRun = false) => {
    runningRef.current = false
    setCurrent(null); setEndsAt(null)
    if (finishedRun) setFinished(true)
    try { await post({ action: 'stop' }) } catch (e) { setErr(e instanceof Error ? e.message : 'Could not stop — stop it in the Rachio app') }
    void wake.current?.release().catch(() => {}); wake.current = null
  }, [post])

  async function start() {
    if (!deviceId || busy) return
    setErr(null); setFinished(false)
    let list = zones
    if (!list) {
      setBusy(true)
      try {
        const res = await fetch(`${base}?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) { setErr(j.error || 'Could not read the controller'); return }
        list = (j.zones ?? []) as Zone[]
        setZones(list); setSeconds(j.seconds ?? 120)
        if (j.controller && j.controller.online === false) setErr('Rachio shows this controller offline — commands may not reach it.')
      } finally { setBusy(false) }
    }
    if (!list?.length) { setErr('No zones are turned on for this controller in Rachio.'); return }
    if (!window.confirm(`Run ${list.length} zone${list.length === 1 ? '' : 's'} on the customer’s controller, ${Math.round(seconds / 60)} minutes each, one after another?`)) return
    runningRef.current = true
    // Keep the phone awake while the run is on (best effort).
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
      if (nav.wakeLock) wake.current = await nav.wakeLock.request('screen')
    } catch { /* not supported — fine */ }
    await runZone(list, 0)
  }

  async function next() {
    if (current == null || !zones || busy) return
    if (current + 1 >= zones.length) { await stopAll(true); return }
    await runZone(zones, current + 1)
  }

  // Countdown; when a zone's time is up, move on (the controller has already shut it off).
  useEffect(() => {
    if (endsAt == null) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [endsAt])
  useEffect(() => {
    if (endsAt == null || busy || !runningRef.current || now < endsAt) return
    void next()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, endsAt, busy])

  // Closing the inspection mid-run stops the water.
  useEffect(() => () => {
    if (runningRef.current) {
      void fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, action: 'stop' }), keepalive: true })
      void wake.current?.release().catch(() => {})
    }
  }, [base, deviceId])

  const left = endsAt != null ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  const running = current != null
  const z = running && zones ? zones[current] : null

  if (!deviceId) {
    return (
      <div className="mt-2 text-[12px] text-white/45">
        ▶ Quick run zones: tap <strong className="text-white/70">⤓ Import from Rachio</strong> at the top first to choose the customer’s controller.
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 space-y-1.5">
      {running && z ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-white truncate">
              <span className="font-semibold">Zone {z.number}</span>{z.name ? <span className="text-white/60"> · {z.name}</span> : null}
            </div>
            <div className="text-[11px] text-emerald-200/80">{current! + 1} of {zones!.length} · <span className="tabular-nums font-semibold">{busy ? '…' : mmss}</span> left</div>
          </div>
          <button type="button" onClick={next} disabled={busy} className="px-3 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-sm font-semibold disabled:opacity-50">
            {current! + 1 >= (zones?.length ?? 0) ? 'Finish' : 'Next ⏭'}
          </button>
          <button type="button" onClick={() => stopAll()} disabled={busy} className="px-3 py-2 rounded-md bg-red-600 hover:bg-red-500 text-sm font-semibold disabled:opacity-50">Stop ■</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" onClick={start} disabled={busy} className="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold disabled:opacity-50">
            {busy ? 'Starting…' : finished ? '▶ Run again' : '▶ Quick run zones'}
          </button>
          <span className="text-[11px] text-white/50">{finished ? 'All zones done — the controller is stopped.' : `${Math.round(seconds / 60)} min each, one after another`}</span>
        </div>
      )}
      {err && <div className="text-[12px] text-red-300">{err}</div>}
    </div>
  )
}
