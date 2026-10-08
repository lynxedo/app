'use client'

// "Import from Rachio" at the top of the irrigation inspection (Ben, Oct 7
// 2026). Lists the controllers on the company's Rachio account — nearest the
// customer's property first — and hands the picked one's zones, head types,
// sun / slope, controller and schedule to the form, which fills BLANK fields
// only and marks them amber for the tech to check. Read-only on Rachio.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DictatedZone, IrrigationData } from '@/lib/irrigation'
import RachioTestRun from './RachioTestRun'

type Choice = { id: string; name: string; model: string; zones: number; miles: number | null; online: boolean; match: boolean }
export type RachioImportPayload = { system: Partial<IrrigationData>; systemFields: string[]; zones: DictatedZone[]; notes: string[]; controllerName: string; deviceId: string }

export default function RachioImport({ contactId, inspectionId, onImport, deviceId, onDevice }: {
  contactId: string
  inspectionId: string
  /** Returns a one-line summary of what was filled. */
  onImport: (p: RachioImportPayload) => string
  /** The customer's controller, once known (set by an import or by picking one for a test run). */
  deviceId: string | null
  onDevice: (id: string) => void
}) {
  const [purpose, setPurpose] = useState<'import' | 'run'>('import')
  const [testing, setTesting] = useState(false)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Choice[] | null>(null)
  const [located, setLocated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ summary: string; notes: string[] } | null>(null)
  const base = `/api/hub/contacts/${contactId}/irrigation/${inspectionId}/rachio`
  const loading = useRef<Promise<void> | null>(null)
  const [notConnected, setNotConnected] = useState(false)

  // A big Rachio account takes ~20 s to read the first time, so start as soon
  // as the form opens — by the time the tech taps the button it's usually ready.
  const fetchList = useCallback(() => {
    if (!loading.current) {
      loading.current = (async () => {
        try {
          const res = await fetch(base, { cache: 'no-store' })
          const j = await res.json().catch(() => ({}))
          if (!res.ok) {
            if (j.code === 'not_connected') setNotConnected(true)
            setErr(j.error || 'Could not reach Rachio')
            loading.current = null // let a tap try again
            return
          }
          setErr(null)
          setList(j.controllers ?? []); setLocated(!!j.located)
        } catch {
          setErr('Could not reach Rachio'); loading.current = null
        }
      })()
    }
    return loading.current
  }, [base])
  useEffect(() => { void fetchList() }, [fetchList])

  function testRun() {
    if (deviceId) { setTesting(true); return }
    void begin('run')
  }

  async function start() { return begin('import') }

  async function begin(why: 'import' | 'run') {
    setPurpose(why)
    setOpen(true); setDone(null)
    if (list) return
    setBusy(true)
    try { await fetchList() } finally { setBusy(false) }
  }

  async function pick(c: Choice) {
    if (purpose === 'run') { onDevice(c.id); setOpen(false); setTesting(true); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: c.id }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.import) { setErr(j.error || 'Could not import'); return }
      const summary = onImport(j.import as RachioImportPayload)
      setDone({ summary, notes: (j.import as RachioImportPayload).notes ?? [] })
      setOpen(false)
    } finally { setBusy(false) }
  }

  // No Rachio key for the company → no button (nothing to import from).
  if (notConnected) return null

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={start} className="px-3 py-2 rounded-md bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sm text-sky-200">
          ⤓ Import from Rachio
        </button>
        <button type="button" onClick={testRun} className="px-3 py-2 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-sm text-emerald-200">
          ▶ Test run zones
        </button>
      </div>
      {testing && deviceId && (
        <RachioTestRun contactId={contactId} inspectionId={inspectionId} deviceId={deviceId} onClose={() => setTesting(false)} />
      )}
      {done && (
        <div className="mt-2 text-[12px] text-sky-200 bg-sky-500/10 border border-sky-500/20 rounded px-2.5 py-1.5 space-y-0.5">
          <div>{done.summary} Amber fields came from Rachio — check them.</div>
          {done.notes.map((n, i) => <div key={i} className="text-white/60">• {n}</div>)}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-md max-h-[80vh] bg-gray-950 border border-gray-800 rounded-t-xl sm:rounded-xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom,0px)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="text-sm font-semibold text-white">{purpose === 'run' ? 'Which controller to test?' : 'Which Rachio controller?'}</div>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-white/60 hover:text-white">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {err && <div className="m-3 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{err}</div>}
              {busy && !list && <div className="p-4 text-sm text-white/50">Reading Rachio… the first time can take about 20 seconds.</div>}
              {list && list.length === 0 && (
                <div className="p-4 text-sm text-white/60">No controllers are on the company’s Rachio account. The customer may need to share their controller with Heroes in the Rachio app.</div>
              )}
              {list && list.length > 0 && !located && (
                <div className="px-4 pt-3 text-[12px] text-white/45">Listed by name — we couldn’t place this customer on the map.</div>
              )}
              <div className="divide-y divide-white/5">
                {(list ?? []).map(c => (
                  <button key={c.id} type="button" disabled={busy} onClick={() => pick(c)} className="w-full text-left px-4 py-3 hover:bg-white/5 disabled:opacity-50 flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm text-white truncate">{c.name}{c.match && <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-300">likely match</span>}</span>
                      <span className="block text-[11px] text-white/45">{[c.model, `${c.zones} zone${c.zones === 1 ? '' : 's'}`, c.online ? null : 'offline'].filter(Boolean).join(' · ')}</span>
                    </span>
                    {c.miles != null && <span className={`text-[12px] shrink-0 ${c.miles < 0.2 ? 'text-emerald-300' : 'text-white/45'}`}>{c.miles < 0.1 ? 'at this address' : `${c.miles} mi`}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
