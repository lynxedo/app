'use client'

import { useCallback, useEffect, useState } from 'react'

// Amber's approval queue — the top of the /hub/amber screen.
//
// Each card is something Amber wants to do on her own: why, and exactly what
// will happen (the real recipient and the exact words). Approve runs it, Edit
// lets an approver reword the message first, Reject drops it with an optional
// note. Every decision is kept — it is how we learn which actions she gets right.

type Item = {
  id: string
  action: string
  args: Record<string, unknown>
  preview: string
  reason: string
  source: string
  status: string
  edited: boolean
  result: string | null
  decided_by: string | null
  decided_at: string | null
  reject_note: string | null
  created_at: string
}
type Payload = {
  pending: Item[]
  recent: Item[]
  canApprove: boolean
  actions: Record<string, { label: string; editable: string[] }>
  names: Record<string, string>
}

const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  approved: 'Approved',
  rejected: 'Rejected',
  auto: 'Ran automatically',
  failed: 'Failed',
  expired: 'Expired',
  superseded: 'Replaced',
}

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export default function AmberApprovals() {
  const [data, setData] = useState<Payload | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})
  const [showRecent, setShowRecent] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/amber/queue', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setData((await res.json()) as Payload)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  async function decide(item: Item, body: Record<string, unknown>) {
    setBusy(item.id)
    setErr((e) => ({ ...e, [item.id]: '' }))
    try {
      const res = await fetch(`/api/hub/amber/queue/${item.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        // A 409 usually means the card changed on the server: show the new one.
        if (res.status === 409) await load()
        throw new Error(j?.error || `Failed (${res.status})`)
      }
      setEditing(null)
      setRejecting(null)
      setNote('')
      await load()
    } catch (e) {
      setErr((x) => ({ ...x, [item.id]: e instanceof Error ? e.message : 'That didn’t go through.' }))
    } finally {
      setBusy(null)
    }
  }

  function startEdit(item: Item) {
    const fields = data?.actions[item.action]?.editable ?? []
    const d: Record<string, string> = {}
    for (const f of fields) d[f] = typeof item.args[f] === 'string' ? (item.args[f] as string) : ''
    setDraft(d)
    setEditing(item.id)
    setRejecting(null)
  }

  if (!data) {
    return (
      <section className="mb-6">
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-500">
          {loadFailed ? "Couldn't load Amber's approval queue. Refresh the page to try again." : 'Loading the approval queue…'}
        </div>
      </section>
    )
  }

  const label = (a: string) => data.actions[a]?.label ?? a

  return (
    <section className="mb-6">
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-white">
            Waiting for approval{data.pending.length ? ` (${data.pending.length})` : ''}
          </h2>
          {!data.canApprove && <span className="text-xs text-gray-500">You can see these, but you aren’t an approver.</span>}
        </div>

        {data.pending.length === 0 && (
          <p className="text-sm text-gray-500">Nothing waiting. When Amber wants to do something on her own, it shows up here.</p>
        )}

        {data.pending.map((item) => (
          <div key={item.id} className="rounded-xl border border-gray-800 bg-gray-950/40 p-4 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-white">{label(item.action)}</p>
              <span className="text-xs text-gray-500">{when(item.created_at)}</span>
            </div>
            {item.reason && <p className="text-sm text-gray-300">{item.reason}</p>}

            {editing === item.id ? (
              <div className="space-y-2">
                {Object.keys(draft).map((f) => (
                  <textarea
                    key={f}
                    value={draft[f]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                    rows={4}
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                ))}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => decide(item, { decision: 'approve', edits: draft, seenPreview: item.preview })}
                    className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium text-white"
                  >
                    Approve with my changes
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm text-gray-300">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-200 bg-gray-950/60 rounded-lg p-3">{item.preview}</pre>
            )}

            {rejecting === item.id && (
              <div className="space-y-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why not? (optional — helps Amber learn)"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => decide(item, { decision: 'reject', note })}
                    className="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-sm font-medium text-white"
                  >
                    Reject
                  </button>
                  <button type="button" onClick={() => setRejecting(null)} className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm text-gray-300">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {data.canApprove && editing !== item.id && rejecting !== item.id && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy === item.id}
                  onClick={() => decide(item, { decision: 'approve', seenPreview: item.preview })}
                  className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium text-white"
                >
                  {busy === item.id ? 'Working…' : 'Approve'}
                </button>
                {(data.actions[item.action]?.editable.length ?? 0) > 0 && (
                  <button type="button" onClick={() => startEdit(item)} className="px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 text-sm text-gray-200">
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setRejecting(item.id)
                    setNote('')
                  }}
                  className="px-3 py-1.5 rounded-lg border border-gray-700 hover:border-red-500/60 text-sm text-gray-200"
                >
                  Reject
                </button>
              </div>
            )}
            {err[item.id] && <p className="text-xs text-red-400">{err[item.id]}</p>}
          </div>
        ))}

        {data.recent.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowRecent((v) => !v)} className="text-xs text-gray-400 hover:text-gray-200">
              {showRecent ? 'Hide' : 'Show'} recent decisions ({data.recent.length})
            </button>
            {showRecent && (
              <ul className="mt-2 space-y-2">
                {data.recent.map((r) => (
                  <li key={r.id} className="text-xs text-gray-400 border-t border-gray-800 pt-2">
                    <span className="text-gray-200">{label(r.action)}</span> ·{' '}
                    {r.status === 'running' && r.decided_at && Date.now() - Date.parse(r.decided_at) > 10 * 60_000
                      ? 'Outcome unknown — check Txt / the Hub before redoing it'
                      : STATUS_LABEL[r.status] ?? r.status}
                    {r.edited ? ' (edited)' : ''}
                    {r.decided_by && data.names[r.decided_by] ? ` by ${data.names[r.decided_by]}` : ''} · {when(r.decided_at || r.created_at)}
                    {r.reason && <div className="text-gray-500">{r.reason}</div>}
                    {r.reject_note && <div className="text-gray-500">Note: {r.reject_note}</div>}
                    {r.result && r.status !== 'rejected' && <div className="text-gray-500">{r.result}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
