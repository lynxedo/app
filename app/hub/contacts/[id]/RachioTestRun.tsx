'use client'

// ▶ Test run zones (Ben, Oct 8 2026): run each zone on the customer's Rachio
// controller for 2 minutes, one after another, with Next (skip ahead) and Stop.
// The phone steps through the list, but each start carries its own 2-minute
// limit — so if the phone loses signal or the tech walks off, the controller
// still shuts the zone off by itself. Closing the panel stops the water.

import { useCallback, useEffect, useRef, useState } from 'react'

type Zone = { id: string; number: number; name: string }

export default function RachioTestRun({ contactId, inspectionId, deviceId, onClose }: {
  contactId: string
  inspectionId: string
  deviceId: string
  onClose: () => void
}) {
  const base = `/api/hub/contacts/${contactId}/irrigation/${inspectionId}/rachio/run`
  const [controller, setController] = useState<{ name: string; online: boolean } | null>(null)
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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`${base}?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok) { setErr(j.error || 'Could not read the controller'); return }
      setController(j.controller); setZones(j.zones ?? []); setSeconds(j.seconds ?? 120)
    })()
    return () => { cancelled = true }
  }, [base, deviceId])

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, ...body }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || 'Rachio didn’t respond')
    return j
  }, [base, deviceId])

  const runZone = useCallback(async (i: number) => {
    if (!zones || i >= zones.length) return
    setBusy(true); setErr(null)
    try {
      await post({ action: 'zone', zoneId: zones[i].id })
      setCurrent(i); setEndsAt(Date.now() + seconds * 1000); setNow(Date.now())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the zone')
    } finally { setBusy(false) }
  }, [zones, post, seconds])

  const stopAll = useCallback(async (finishedRun = false) => {
    runningRef.current = false
    setCurrent(null); setEndsAt(null)
    if (finishedRun) setFinished(true)
    try { await post({ action: 'stop' }) } catch (e) { setErr(e instanceof Error ? e.message : 'Could not stop — stop it in the Rachio app') }
    void wake.current?.release().catch(() => {}); wake.current = null
  }, [post])

  async function start() {
    if (!zones?.length) return
    if (!window.confirm(`This runs ${zones.length} zone${zones.length === 1 ? '' : 's'} on the customer’s controller, ${Math.round(seconds / 60)} minutes each, one after another. Start?`)) return
    runningRef.current = true; setFinished(false)
    // Keep the phone awake while the run is on (best effort).
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
      if (nav.wakeLock) wake.current = await nav.wakeLock.request('screen')
    } catch { /* not supported — fine */ }
    await runZone(0)
  }

  async function next() {
    if (current == null || !zones) return
    if (current + 1 >= zones.length) { await stopAll(true); return }
    await runZone(current + 1)
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

  // Leaving the panel mid-run stops the water.
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

  return (
    <div className="fixed inset-0 z-[70] bg-[var(--t-panel-deep)] text-white flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] border-b border-white/10">
        <button type="button" onClick={async () => { if (running) await stopAll(); onClose() }} className="text-sm text-white/70 hover:text-white">‹ Done</button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">Test run zones</div>
          <div className="text-[11px] text-white/45 truncate">{controller ? `${controller.name}${controller.online ? '' : ' · offline'}` : 'Reading the controller…'}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md w-full mx-auto space-y-4">
        {err && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{err}</div>}
        {controller && !controller.online && <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">Rachio shows this controller offline — commands may not reach it.</div>}

        {running && z ? (
          <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-5 text-center space-y-1">
            <div className="text-[12px] uppercase tracking-wide text-sky-300">Running · {current! + 1} of {zones!.length}</div>
            <div className="text-2xl font-semibold">Zone {z.number}</div>
            {z.name && <div className="text-sm text-white/70">{z.name}</div>}
            <div className="text-5xl font-bold tabular-nums pt-2">{busy ? '…' : mmss}</div>
          </div>
        ) : finished ? (
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-5 text-center text-emerald-100">All zones done — the controller is stopped.</div>
        ) : (
          <div className="text-sm text-white/70">
            Runs each zone for <strong className="text-white">{Math.round(seconds / 60)} minutes</strong>, one after another. Tap <strong className="text-white">Next</strong> to skip ahead, <strong className="text-white">Stop</strong> to stop the water. Each zone also shuts itself off after {Math.round(seconds / 60)} minutes, even if your phone loses signal.
          </div>
        )}

        {running ? (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={next} disabled={busy} className="py-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-lg font-semibold disabled:opacity-50">
              {current! + 1 >= (zones?.length ?? 0) ? 'Finish' : 'Next ⏭'}
            </button>
            <button type="button" onClick={() => stopAll()} disabled={busy} className="py-4 rounded-xl bg-red-600 hover:bg-red-500 text-lg font-semibold disabled:opacity-50">Stop ■</button>
          </div>
        ) : (
          <button type="button" onClick={start} disabled={busy || !zones?.length} className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-lg font-semibold disabled:opacity-50">
            ▶ {finished ? 'Run again' : 'Start test run'}
          </button>
        )}

        {zones && (
          <div className="rounded-lg border border-white/10 divide-y divide-white/5">
            {zones.length === 0 && <div className="p-3 text-sm text-white/50">No zones are turned on for this controller in Rachio.</div>}
            {zones.map((x, i) => (
              <div key={x.id} className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${i === current ? 'bg-sky-500/10' : ''}`}>
                <span className="min-w-0 truncate"><span className="text-white/90">Zone {x.number}</span>{x.name && <span className="text-white/50"> · {x.name}</span>}</span>
                <span className="text-[12px] shrink-0 text-white/50">
                  {i === current ? <span className="text-sky-300">running</span> : running && current != null && i < current ? '✓' : finished ? '✓' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
