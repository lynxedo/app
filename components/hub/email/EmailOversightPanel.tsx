'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui'
import {
  waitedFor,
  participantName,
  firstName,
  type EmailThread,
} from './emailFormat'

/**
 * Manager oversight dashboard for the shared inbox (full-access only). Surfaces
 * the "nothing falls through" signals: how many threads are unassigned, how many
 * are awaiting a reply, an oldest-first aging list, and a per-rep workload count.
 * Read-only — every row links into the thread.
 */
export default function EmailOversightPanel() {
  const router = useRouter()
  const [unassigned, setUnassigned] = useState<EmailThread[]>([])
  const [needsReply, setNeedsReply] = useState<EmailThread[]>([])
  const [all, setAll] = useState<EmailThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [u, n, a] = await Promise.all([
          fetch('/api/hub/email/threads?scope=unassigned&account=shared&limit=100'),
          fetch('/api/hub/email/threads?scope=needs_reply&account=shared&limit=100'),
          fetch('/api/hub/email/threads?scope=all&account=shared&limit=200'),
        ])
        if (cancelled) return
        if (u.ok) setUnassigned(((await u.json()).threads || []) as EmailThread[])
        if (n.ok) setNeedsReply(((await n.json()).threads || []) as EmailThread[])
        if (a.ok) setAll(((await a.json()).threads || []) as EmailThread[])
        if (!u.ok && !n.ok && !a.ok) setError('Could not load the inbox overview.')
      } catch {
        if (!cancelled) setError('Could not load the inbox overview.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const t = setInterval(load, 60000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  // Aging list — oldest inbound first. Prefer the derived needs-reply set, and
  // fold in any unassigned threads that aren't already in it.
  const aging = useMemo(() => {
    const byId = new Map<string, EmailThread>()
    for (const t of needsReply) byId.set(t.id, t)
    for (const t of unassigned) if (!byId.has(t.id)) byId.set(t.id, t)
    return Array.from(byId.values())
      .filter((t) => t.status !== 'closed')
      .sort(
        (a, b) =>
          new Date(a.last_message_at || 0).getTime() -
          new Date(b.last_message_at || 0).getTime()
      )
      .slice(0, 12)
  }, [needsReply, unassigned])

  // Per-rep workload — open (non-closed) threads grouped by assignee.
  const workload = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of all) {
      if (t.status === 'closed' || !t.assigned_to_user_id) continue
      const name = t.assignee_name || 'Unknown'
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [all])

  const openCount = all.filter((t) => t.status !== 'closed').length

  if (loading) {
    return (
      <div className="w-full max-w-3xl py-10 flex justify-center">
        <Spinner size={8} />
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl text-left space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Inbox oversight</h1>
        <p className="text-sm text-white/50">
          Make sure nothing falls through — pick a conversation from the sidebar, or
          jump straight to what needs attention below.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-[var(--t-tint-danger)]">
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Unassigned" value={unassigned.length} tone={unassigned.length ? 'warn' : 'ok'} />
        <Kpi
          label="Awaiting reply"
          value={needsReply.length}
          tone={needsReply.length ? 'warn' : 'ok'}
        />
        <Kpi label="Open threads" value={openCount} tone="neutral" />
      </div>

      {/* Aging list */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/10 text-sm font-medium">
          Needs a reply <span className="text-white/40">· oldest first</span>
        </div>
        {aging.length === 0 ? (
          <div className="px-4 py-6 text-sm text-white/45 text-center">
            Nothing is waiting on a reply. 🎉
          </div>
        ) : (
          <ul className="divide-y divide-white/10">
            {aging.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/hub/email/${t.id}`)}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {t.subject || '(no subject)'}
                    </div>
                    <div className="text-xs text-white/45 truncate">
                      {participantName(t.from_name, t.from_email)}
                      {t.snippet ? ` — ${t.snippet}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    {t.assigned_to_user_id && t.assignee_name ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-[var(--t-tint-success)]">
                        {firstName(t.assignee_name)}
                      </span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-orange-500/20 text-[var(--t-tint-orange)]">
                        Unassigned
                      </span>
                    )}
                    <span
                      className="text-[11px] text-white/50 whitespace-nowrap"
                      title="Waiting since the last inbound message"
                    >
                      {waitedFor(t.last_message_at)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Per-rep workload */}
      {workload.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/10 text-sm font-medium">
            Workload <span className="text-white/40">· open threads per person</span>
          </div>
          <ul className="divide-y divide-white/10">
            {workload.map(([name, count]) => (
              <li
                key={name}
                className="px-4 py-2 flex items-center justify-between text-sm"
              >
                <span className="truncate">{name}</span>
                <span className="text-white/50">
                  {count} open
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'ok' | 'warn' | 'neutral'
}) {
  const toneCls =
    tone === 'warn' && value > 0
      ? 'text-[var(--t-tint-orange)]'
      : tone === 'ok'
      ? 'text-[var(--t-tint-success)]'
      : 'text-white'
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className={`text-2xl font-semibold ${toneCls}`}>{value}</div>
      <div className="text-xs text-white/50 mt-0.5">{label}</div>
    </div>
  )
}
