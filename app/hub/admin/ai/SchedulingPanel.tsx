'use client'

import { useEffect, useState } from 'react'
import type {
  SchedulableServiceRow,
  SchedulingCommitment,
  SchedulingMode,
  TimeFrame,
} from '@/lib/voice-scheduling'

// Admin config for the AI Receptionist's Level 4 scheduling. The owner picks
// which Jobber line items the receptionist may schedule and the rules for each.
// Self-fetches its config on mount and pulls the line-item catalog + team list
// from Jobber on demand (same pattern as the Route Optimizer settings). Live
// scheduling behavior activates at Level 4 (still coming soon); this just holds
// the rules.

type ServiceForm = {
  line_item: string
  mode: SchedulingMode
  enabled: boolean
  duration_minutes: number
  max_per_day: number
  time_frames: TimeFrame[]
  offered_days: number[]
  assigned_user_ids: string[]
  lead_days: number
  horizon_days: number
  commitment: SchedulingCommitment
  frequencies: string[]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FREQS: { value: string; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
]

const newService = (line_item: string): ServiceForm => ({
  line_item,
  mode: 'appointment',
  enabled: true,
  duration_minutes: 60,
  max_per_day: 4,
  time_frames: [{ start: '08:00', end: '12:00' }],
  offered_days: [],
  assigned_user_ids: [],
  lead_days: 1,
  horizon_days: 30,
  commitment: 'request',
  frequencies: [],
})

const toForm = (r: SchedulableServiceRow): ServiceForm => ({
  line_item: r.line_item,
  mode: r.mode,
  enabled: r.enabled,
  duration_minutes: r.duration_minutes,
  max_per_day: r.max_per_day,
  time_frames: Array.isArray(r.time_frames) ? r.time_frames : [],
  offered_days: Array.isArray(r.offered_days) ? r.offered_days : [],
  assigned_user_ids: Array.isArray(r.assigned_user_ids) ? r.assigned_user_ids : [],
  lead_days: r.lead_days,
  horizon_days: r.horizon_days,
  commitment: r.commitment,
  frequencies: Array.isArray(r.frequencies) ? r.frequencies : [],
})

const inputCls =
  'bg-white/5 border border-white/10 rounded px-2.5 py-1 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function SchedulingPanel() {
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [enabled, setEnabled] = useState(false)
  const [services, setServices] = useState<ServiceForm[]>([])
  const [snapshot, setSnapshot] = useState('') // JSON of last-saved {enabled, services}

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Jobber-sourced pickers, loaded on demand.
  const [lineItems, setLineItems] = useState<string[]>([])
  const [team, setTeam] = useState<{ id: string; name: string }[]>([])
  const [jobberLoading, setJobberLoading] = useState(false)
  const [jobberErr, setJobberErr] = useState<string | null>(null)
  const [jobberLoaded, setJobberLoaded] = useState(false)
  const [addSel, setAddSel] = useState('')

  const snap = (en: boolean, svc: ServiceForm[]) => JSON.stringify({ enabled: en, services: svc })
  const dirty = snap(enabled, services) !== snapshot

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/voice-scheduling')
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? `Load failed (${res.status})`)
        if (!alive) return
        const svc = (data.services as SchedulableServiceRow[]).map(toForm)
        setEnabled(Boolean(data.scheduling_enabled))
        setServices(svc)
        setSnapshot(snap(Boolean(data.scheduling_enabled), svc))
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const loadFromJobber = async () => {
    setJobberLoading(true)
    setJobberErr(null)
    try {
      const [liRes, uRes] = await Promise.all([
        fetch('/api/jobber/line-items'),
        fetch('/api/users?include_all=1'),
      ])
      const li = await liRes.json()
      const u = await uRes.json()
      if (!liRes.ok || li.error) throw new Error(li.error ?? 'Could not load services from Jobber')
      if (!uRes.ok || u.error) throw new Error(u.error ?? 'Could not load team from Jobber')
      setLineItems((li.lineItems as string[]) ?? [])
      setTeam(((u.users as { id: string; name: string }[]) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))
      setJobberLoaded(true)
    } catch (e) {
      setJobberErr(e instanceof Error ? e.message : String(e))
    } finally {
      setJobberLoading(false)
    }
  }

  const update = (i: number, patch: Partial<ServiceForm>) =>
    setServices((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const removeService = (i: number) => setServices((prev) => prev.filter((_, idx) => idx !== i))
  const addService = (lineItem: string) => {
    if (!lineItem) return
    if (services.some((s) => s.line_item.toLowerCase() === lineItem.toLowerCase())) return
    setServices((prev) => [...prev, newService(lineItem)])
    setAddSel('')
  }
  const toggleDay = (i: number, day: number) =>
    update(i, {
      offered_days: services[i].offered_days.includes(day)
        ? services[i].offered_days.filter((d) => d !== day)
        : [...services[i].offered_days, day].sort((a, b) => a - b),
    })
  const toggleAssignee = (i: number, uid: string) =>
    update(i, {
      assigned_user_ids: services[i].assigned_user_ids.includes(uid)
        ? services[i].assigned_user_ids.filter((x) => x !== uid)
        : [...services[i].assigned_user_ids, uid],
    })
  const toggleFreq = (i: number, freq: string) =>
    update(i, {
      frequencies: services[i].frequencies.includes(freq)
        ? services[i].frequencies.filter((x) => x !== freq)
        : [...services[i].frequencies, freq],
    })
  const setFrame = (i: number, j: number, field: 'start' | 'end', v: string) =>
    update(i, { time_frames: services[i].time_frames.map((f, idx) => (idx === j ? { ...f, [field]: v } : f)) })
  const addFrame = (i: number) =>
    update(i, { time_frames: [...services[i].time_frames, { start: '08:00', end: '12:00' }] })
  const removeFrame = (i: number, j: number) =>
    update(i, { time_frames: services[i].time_frames.filter((_, idx) => idx !== j) })

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/voice-scheduling', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduling_enabled: enabled, services }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`)
      const svc = (data.services as SchedulableServiceRow[]).map(toForm)
      setEnabled(Boolean(data.scheduling_enabled))
      setServices(svc)
      setSnapshot(snap(Boolean(data.scheduling_enabled), svc))
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const revert = () => {
    try {
      const s = JSON.parse(snapshot) as { enabled: boolean; services: ServiceForm[] }
      setEnabled(s.enabled)
      setServices(s.services)
      setError(null)
    } catch {
      /* no snapshot yet */
    }
  }

  const availableToAdd = lineItems.filter(
    (li) => !services.some((s) => s.line_item.toLowerCase() === li.toLowerCase()),
  )

  return (
    <section className="border border-white/10 rounded-lg p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Scheduling</h2>
        <p className="text-xs text-white/50 mt-0.5">
          Choose which of your Jobber services the receptionist may schedule, and the rules for each.
        </p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200 leading-relaxed">
        Live scheduling runs at <strong>Level&nbsp;4</strong> (coming soon) — you can set it up now and it activates when
        Level&nbsp;4 turns on. Everything here starts <strong>off</strong>: the receptionist schedules nothing until you turn
        on the switch and add a service.
      </div>

      {loading ? (
        <p className="text-xs text-white/40">Loading…</p>
      ) : loadErr ? (
        <p className="text-xs text-red-400">{loadErr}</p>
      ) : (
        <>
          {/* Master switch */}
          <div className="flex items-center justify-between border border-white/10 rounded-lg p-3">
            <div className="pr-3">
              <p className="text-sm font-medium text-white">Let the receptionist schedule</p>
              <p className="text-xs text-white/50 mt-0.5">
                Master switch. When off, the receptionist takes a message and a person schedules — even if services are
                configured below.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
                enabled ? 'bg-brand' : 'bg-white/20'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Add a service */}
          <div className="border border-white/10 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">Schedulable services</p>
                <p className="text-xs text-white/50 mt-0.5">
                  Pull your service catalog from Jobber, then add the ones the receptionist may schedule. Add-on items a tech
                  adds at the visit don&apos;t belong here — just the services people call to book.
                </p>
              </div>
              <button
                type="button"
                onClick={loadFromJobber}
                disabled={jobberLoading}
                className="px-3 py-1.5 border border-white/15 hover:border-white/30 disabled:opacity-50 rounded-lg text-xs font-medium text-white/80 whitespace-nowrap"
              >
                {jobberLoading ? 'Loading…' : jobberLoaded ? '↻ Reload from Jobber' : '↻ Load from Jobber'}
              </button>
            </div>
            {jobberErr && <p className="text-xs text-red-400">{jobberErr}</p>}
            {jobberLoaded && (
              <p className="text-xs text-emerald-300">
                {lineItems.length} services · {team.length} team members loaded
              </p>
            )}
            {jobberLoaded && (
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={addSel}
                  onChange={(e) => setAddSel(e.target.value)}
                  className={`${inputCls} flex-1 min-w-0`}
                >
                  <option value="">
                    {availableToAdd.length ? '— select a service to add —' : 'All services added'}
                  </option>
                  {availableToAdd.map((li) => (
                    <option key={li} value={li}>
                      {li}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => addService(addSel)}
                  disabled={!addSel}
                  className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-light disabled:opacity-40 text-sm font-medium whitespace-nowrap"
                >
                  + Add
                </button>
              </div>
            )}
            {!jobberLoaded && services.length === 0 && (
              <p className="text-xs text-white/40">Click “Load from Jobber” to pick services.</p>
            )}
          </div>

          {/* Configured services */}
          {services.map((s, i) => (
            <div key={`${s.line_item}-${i}`} className="border border-white/10 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-white truncate">{s.line_item}</p>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={() => update(i, { enabled: !s.enabled })}
                      className="accent-brand"
                    />
                    On
                  </label>
                  <button
                    type="button"
                    onClick={() => removeService(i)}
                    aria-label="Remove service"
                    className="text-white/40 hover:text-red-400 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Mode */}
              <div className="flex gap-2">
                {(['appointment', 'recurring'] as SchedulingMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => update(i, { mode: m })}
                    className={`flex-1 text-left border rounded-lg p-2 transition-colors ${
                      s.mode === m ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/25'
                    }`}
                  >
                    <p className="text-sm font-medium text-white">
                      {m === 'appointment' ? 'Appointment' : 'Recurring'}
                    </p>
                    <p className="text-xs text-white/50 mt-0.5">
                      {m === 'appointment'
                        ? 'Books a specific visit live on the call.'
                        : 'Signs the customer up; notified before each visit.'}
                    </p>
                  </button>
                ))}
              </div>

              {s.mode === 'appointment' ? (
                <>
                  {/* Numbers */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <label className="block">
                      <span className="text-xs text-white/50 block mb-1">Job length (min)</span>
                      <input
                        type="number"
                        min={1}
                        max={480}
                        value={s.duration_minutes}
                        onChange={(e) => update(i, { duration_minutes: Number(e.target.value) })}
                        className={`${inputCls} w-full`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-white/50 block mb-1">Max per day</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={s.max_per_day}
                        onChange={(e) => update(i, { max_per_day: Number(e.target.value) })}
                        className={`${inputCls} w-full`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-white/50 block mb-1">Earliest (days out)</span>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        value={s.lead_days}
                        onChange={(e) => update(i, { lead_days: Number(e.target.value) })}
                        className={`${inputCls} w-full`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-white/50 block mb-1">Schedule out (days)</span>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={s.horizon_days}
                        onChange={(e) => update(i, { horizon_days: Number(e.target.value) })}
                        className={`${inputCls} w-full`}
                      />
                    </label>
                  </div>

                  {/* Offered days */}
                  <div>
                    <span className="text-xs text-white/50 block mb-1">Offered days</span>
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS.map((d, idx) => {
                        const on = s.offered_days.includes(idx)
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => toggleDay(i, idx)}
                            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                              on ? 'border-brand bg-brand/10 text-white' : 'border-white/10 text-white/50 hover:border-white/25'
                            }`}
                          >
                            {d}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-xs text-white/40 mt-1">None selected = any day.</p>
                  </div>

                  {/* Time frames */}
                  <div>
                    <span className="text-xs text-white/50 block mb-1">Time frames offered (arrival windows)</span>
                    <div className="space-y-1.5">
                      {s.time_frames.map((f, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={f.start}
                            onChange={(e) => setFrame(i, j, 'start', e.target.value)}
                            className={inputCls}
                          />
                          <span className="text-white/40 text-xs">to</span>
                          <input
                            type="time"
                            value={f.end}
                            onChange={(e) => setFrame(i, j, 'end', e.target.value)}
                            className={inputCls}
                          />
                          <button
                            type="button"
                            onClick={() => removeFrame(i, j)}
                            aria-label="Remove window"
                            className="text-white/40 hover:text-red-400 text-lg leading-none"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => addFrame(i)} className="text-xs text-brand hover:underline mt-1.5">
                      + Add a window
                    </button>
                  </div>

                  {/* Commitment */}
                  <div>
                    <span className="text-xs text-white/50 block mb-1">When the receptionist schedules this</span>
                    <div className="space-y-1.5">
                      {(
                        [
                          {
                            v: 'request' as SchedulingCommitment,
                            t: 'Create a Jobber request to confirm',
                            d: 'Lands in your Requests inbox with the chosen slot; a person clicks convert. Recommended.',
                          },
                          {
                            v: 'direct' as SchedulingCommitment,
                            t: 'Book the appointment directly',
                            d: 'Writes the booking straight into Jobber with no human step. Coming soon — for now these still file as a request to confirm.',
                          },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => update(i, { commitment: opt.v })}
                          className={`w-full text-left border rounded-lg p-2 transition-colors ${
                            s.commitment === opt.v ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/25'
                          }`}
                        >
                          <p className="text-sm font-medium text-white">{opt.t}</p>
                          <p className="text-xs text-white/50 mt-0.5">{opt.d}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                /* Recurring */
                <div>
                  <span className="text-xs text-white/50 block mb-1">Frequencies offered</span>
                  <div className="flex flex-wrap gap-1.5">
                    {FREQS.map((f) => {
                      const on = s.frequencies.includes(f.value)
                      return (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => toggleFreq(i, f.value)}
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            on ? 'border-brand bg-brand/10 text-white' : 'border-white/10 text-white/50 hover:border-white/25'
                          }`}
                        >
                          {f.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-white/40 mt-1.5">
                    The receptionist signs the customer up and confirms the start week — no exact time is promised on the call.
                    A person finalizes the recurring job in Jobber.
                  </p>
                </div>
              )}

              {/* Assign to */}
              <div>
                <span className="text-xs text-white/50 block mb-1">Assign to</span>
                {!jobberLoaded ? (
                  <p className="text-xs text-white/40">Load from Jobber above to choose who gets these jobs.</p>
                ) : team.length === 0 ? (
                  <p className="text-xs text-white/40">No team members found in Jobber.</p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto border border-white/10 rounded p-2">
                    {team.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={s.assigned_user_ids.includes(u.id)}
                          onChange={() => toggleAssignee(i, u.id)}
                          className="accent-brand"
                        />
                        {u.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Save / Revert */}
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
            >
              {saving ? 'Saving…' : 'Save scheduling'}
            </button>
            <button
              onClick={revert}
              disabled={saving || !dirty}
              className="px-4 py-2 rounded border border-white/15 hover:border-white/30 disabled:opacity-40 text-sm font-medium text-white/80"
            >
              Revert
            </button>
            {dirty && !error && <span className="text-xs text-amber-300/80">Unsaved changes</span>}
            {!dirty && savedAt && !error && <span className="text-xs text-emerald-300">Saved ✓</span>}
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </>
      )}
    </section>
  )
}
