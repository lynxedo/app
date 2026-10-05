'use client'

import { useCallback, useEffect, useState } from 'react'

// Admin → AI → Amber's account. What Amber may do ON HER OWN (nobody asked her),
// who approves it, and how often her proposals were approved as-is.
//
// Every acting action starts Off. "Needs approval" puts each one in the queue on
// /hub/amber; "Automatic" runs it and logs it. Nothing moves to Automatic by
// itself — the track record is shown so a person decides. Changes save at once
// (Ben: admin toggles autosave).

type Mode = 'off' | 'approve' | 'auto'
type Stats = { approved: number; edited: number; rejected: number; auto: number; failed: number }
type ActionRow = { name: string; label: string; autoAllowed: boolean; mode: Mode; companyAllowed: boolean; stats: Stats }
type Payload = {
  hasAccount: boolean
  assistantEnabled: boolean
  actions: ActionRow[]
  approverIds: string[]
  people: { id: string; name: string }[]
  morning: { enabled: boolean; time: string; days: number[]; roomId: string | null }
  rooms: { id: string; name: string; isPrivate: boolean }[]
  runs: RunRow[]
}
type RunRow = {
  id: string
  kind: string
  run_date: string
  status: string
  started_at: string
  model: string | null
  input_tokens: number
  output_tokens: number
  model_calls: number
  tool_calls: number
  queued: number
  est_cost_usd: number | string | null
  error: string | null
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function runWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function money(v: number | string | null): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `$${n.toFixed(n < 0.1 ? 3 : 2)}` : '—'
}

const MODE_LABEL: Record<Mode, string> = { off: 'Off', approve: 'Needs approval', auto: 'Automatic' }

function record(s: Stats): string {
  const decided = s.approved + s.rejected
  if (decided === 0 && s.auto === 0) return 'No history yet'
  const parts: string[] = []
  if (decided) {
    const clean = s.approved - s.edited
    parts.push(`${clean} of ${decided} approved as written`)
    if (s.edited) parts.push(`${s.edited} edited`)
    if (s.rejected) parts.push(`${s.rejected} rejected`)
  }
  if (s.auto) parts.push(`${s.auto} ran automatically`)
  if (s.failed) parts.push(`${s.failed} failed`)
  return parts.join(' · ') + ' (last 90 days)'
}

export default function AmberAccountPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [testMsg, setTestMsg] = useState('')
  const [runMsg, setRunMsg] = useState('')
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/amber-account', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setData((await res.json()) as Payload)
      setLoadErr('')
    } catch {
      setLoadErr("Couldn't load Amber's account. Refresh to try again.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(body: Record<string, unknown>) {
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/amber-account', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error || `Save failed (${res.status})`)
      }
      setStatus('saved')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : "Couldn't save that.")
      await load()
    }
  }

  function setMode(name: string, mode: Mode) {
    setData((d) => (d ? { ...d, actions: d.actions.map((a) => (a.name === name ? { ...a, mode } : a)) } : d))
    void save({ modes: { [name]: mode } })
  }

  function toggleApprover(id: string) {
    if (!data) return
    const next = data.approverIds.includes(id) ? data.approverIds.filter((x) => x !== id) : [...data.approverIds, id]
    setData({ ...data, approverIds: next })
    void save({ approverIds: next })
  }

  async function sendTest() {
    setTestMsg('Adding a test item…')
    try {
      const res = await fetch('/api/admin/amber-account', { method: 'POST' })
      const j = (await res.json().catch(() => null)) as { result?: string; error?: string } | null
      setTestMsg(res.ok ? j?.result || 'Done.' : j?.error || `Failed (${res.status})`)
    } catch {
      setTestMsg("Couldn't add the test item.")
    }
  }

  function setMorning(patch: Partial<Payload['morning']>) {
    if (!data) return
    setData({ ...data, morning: { ...data.morning, ...patch } })
    void save({ morning: patch })
  }

  async function runNow() {
    setRunning(true)
    setRunMsg('Amber is reading the morning’s facts and writing the summary. This takes up to a minute…')
    try {
      const res = await fetch('/api/admin/amber-account/run', { method: 'POST' })
      const j = (await res.json().catch(() => null)) as { costUsd?: number | null; queued?: number; error?: string } | null
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`)
      setRunMsg(
        `Done. Amber DMed you the summary (cost about ${money(j?.costUsd ?? null)}).` +
          (j?.queued ? ` She queued ${j.queued} follow-up${j.queued === 1 ? '' : 's'} for approval.` : ''),
      )
      await load()
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : 'The test run failed.')
    } finally {
      setRunning(false)
    }
  }

  const postMode = data?.actions.find((a) => a.name === 'post_hub_message')?.mode ?? 'off'

  return (
    <section className="border border-white/10 rounded-lg p-4 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-white">Amber&apos;s account</h2>
        <p className="text-xs text-white/50 mt-0.5">
          What Amber may do on her own, when nobody asked her. When someone DMs her, she still works with that
          person&apos;s permissions, and none of this applies. Her suggestions wait on the{' '}
          <a href="/hub/amber" className="text-sky-400 hover:underline">Amber</a> screen for an approver.
        </p>
      </div>

      {loadErr && <p className="text-xs text-red-400">{loadErr}</p>}
      {!data && !loadErr && <p className="text-xs text-white/40">Loading…</p>}

      {data && (
        <>
          {!data.hasAccount && (
            <p className="text-xs text-amber-300/80">
              This company has no Amber user in the Hub yet, so she can&apos;t act on her own.
            </p>
          )}
          {!data.assistantEnabled && (
            <p className="text-xs text-amber-300/80">
              The Hub Assistant is switched off (Assistant tab), so nothing here will run.
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-white/70">What she may do</p>
            {data.actions.map((a) => (
              <div key={a.name} className="border border-white/10 rounded-lg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-white">{a.label}</p>
                  <div className="flex rounded-lg border border-white/10 overflow-hidden text-xs">
                    {(['off', 'approve', 'auto'] as Mode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={m === 'auto' && !a.autoAllowed}
                        onClick={() => setMode(a.name, m)}
                        className={`px-2.5 py-1 disabled:opacity-30 disabled:cursor-not-allowed ${a.mode === m ? 'bg-brand text-white' : 'text-white/60 hover:text-white'}`}
                      >
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-white/40 mt-1">{record(a.stats)}</p>
                {!a.autoAllowed && (
                  <p className="text-xs text-white/40">
                    Reaches customers, so it always waits for a person. Amber reads what customers write, and a
                    message written to trick her must never send on its own.
                  </p>
                )}
                {!a.companyAllowed && a.mode !== 'off' && (
                  <p className="text-xs text-amber-300/80 mt-1">
                    This is switched off for the assistant in Assistant → Permissions, so it won&apos;t run until
                    that&apos;s on too.
                  </p>
                )}
              </div>
            ))}
            <p className="text-xs text-white/40">
              <strong className="text-white/60">Needs approval</strong>: she prepares it and it waits for a tap.{' '}
              <strong className="text-white/60">Automatic</strong>: it runs right away and is logged. Nothing switches
              to Automatic by itself; the record under each line is there to help you decide.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-white/70">Who approves</p>
            {data.people.length === 0 ? (
              <p className="text-xs text-white/40">No one with AI admin access yet.</p>
            ) : (
              <div className="space-y-1 border border-white/10 rounded p-2">
                {data.people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={data.approverIds.includes(p.id)}
                      onChange={() => toggleApprover(p.id)}
                      className="accent-brand"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-white/40">
              Approvers get a notification when something new is waiting. Only people with AI admin access can be
              picked. With nobody ticked, only company admins can approve.
            </p>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={sendTest}
              disabled={postMode === 'off'}
              className="px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 disabled:opacity-40 text-xs font-medium text-white/80"
            >
              Add a test item
            </button>
            <p className="text-xs text-white/40">
              {postMode === 'off'
                ? 'Turn on “Post a message in the Hub” to try it: the test is Amber asking to DM you.'
                : 'Amber asks to DM you a short test message. Approve it under Amber in the Hub sidebar (below My Tasks) to check the whole loop.'}
            </p>
            {testMsg && <p className="text-xs text-white/60">{testMsg}</p>}
          </div>

          <div className="space-y-2 border-t border-white/10 pt-4">
            <p className="text-xs font-medium text-white/70">Morning summary</p>
            <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
              <input
                type="checkbox"
                checked={data.morning.enabled}
                onChange={() => setMorning({ enabled: !data.morning.enabled })}
                className="accent-brand"
              />
              Post a summary of the day each morning
            </label>
            <div className="flex flex-wrap items-center gap-3 text-sm text-white/80">
              <label className="flex items-center gap-2">
                At
                <input
                  type="time"
                  value={data.morning.time}
                  onChange={(e) => e.target.value && setMorning({ time: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white"
                />
                <span className="text-xs text-white/40">Central</span>
              </label>
              <label className="flex items-center gap-2">
                in
                <select
                  value={data.morning.roomId ?? ''}
                  onChange={(e) => setMorning({ roomId: e.target.value || null })}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white"
                >
                  <option value="">Pick a room…</option>
                  {data.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.name}
                      {r.isPrivate ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              {DAY_LABELS.map((label, d) => {
                const on = data.morning.days.includes(d)
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setMorning({ days: on ? data.morning.days.filter((x) => x !== d) : [...data.morning.days, d].sort() })
                    }
                    className={`px-2 py-0.5 rounded text-xs border ${on ? 'bg-brand border-brand text-white' : 'border-white/15 text-white/50'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-white/40">
              Amber reads today&apos;s schedule, calls and voicemails since yesterday evening, texts waiting on a reply,
              and leads nobody has contacted, then posts a short summary in the room. Anything she wants to do about
              it goes into the approval queue. If the server is down at that time, she skips the day rather than
              posting more than 2 hours late.
            </p>
            {data.morning.enabled && !data.morning.roomId && (
              <p className="text-xs text-amber-300/80">Pick a room, or nothing will be posted.</p>
            )}
            <div className="space-y-1">
              <button
                type="button"
                onClick={runNow}
                disabled={running}
                className="px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 disabled:opacity-40 text-xs font-medium text-white/80"
              >
                {running ? 'Running…' : 'Run it now'}
              </button>
              <p className="text-xs text-white/40">
                A test run: the summary comes to you as a DM instead of the room. Follow-ups she proposes do go into the
                real approval queue.
              </p>
              {runMsg && <p className="text-xs text-white/60">{runMsg}</p>}
            </div>
          </div>

          <div className="space-y-2 border-t border-white/10 pt-4">
            <p className="text-xs font-medium text-white/70">Recent runs and what they cost</p>
            {data.runs.length === 0 ? (
              <p className="text-xs text-white/40">No runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-white/70">
                  <thead>
                    <tr className="text-left text-white/40">
                      <th className="py-1 pr-3 font-normal">When</th>
                      <th className="py-1 pr-3 font-normal">Kind</th>
                      <th className="py-1 pr-3 font-normal">Result</th>
                      <th className="py-1 pr-3 font-normal">Queued</th>
                      <th className="py-1 pr-3 font-normal text-right">Cost (est.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id} className="border-t border-white/5">
                        <td className="py-1 pr-3 whitespace-nowrap">{runWhen(r.started_at)}</td>
                        <td className="py-1 pr-3">{r.kind === 'morning' ? 'Morning summary' : 'Test run'}</td>
                        <td className="py-1 pr-3" title={r.error ?? ''}>
                          {r.status === 'done' ? 'Posted' : r.status === 'running' ? 'Running' : r.status === 'skipped' ? `Skipped: ${r.error ?? ''}` : `Failed: ${r.error ?? ''}`}
                        </td>
                        <td className="py-1 pr-3">{r.queued}</td>
                        <td className="py-1 pr-3 text-right">{money(r.est_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-white/40">
              Estimated from the AI&apos;s published prices. These numbers are what we&apos;ll use to set the daily
              spending cap.
            </p>
          </div>

          <div className="text-xs">
            {status === 'saving' && <span className="text-white/50">Saving…</span>}
            {status === 'saved' && <span className="text-emerald-300">Saved ✓</span>}
            {status === 'error' && <span className="text-red-400">{error}</span>}
          </div>
        </>
      )}
    </section>
  )
}
