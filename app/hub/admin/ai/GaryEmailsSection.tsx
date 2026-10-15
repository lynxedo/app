'use client'

import { useState } from 'react'

// Gary's emails on Admin → AI → Gary's account: write the next few, then each
// waits here for an approver to read, edit if they like, and Approve & send — or
// turn it down. Nothing reaches a customer without that tap.

export type GaryQueueItem = {
  id: string
  channel: 'email' | 'text'
  to_email: string | null
  to_phone: string | null
  to_name: string | null
  subject: string
  body: string
  context: { services?: string[]; sources?: { kind: 'lead' | 'quote'; id: string; detail: string; date: string | null; link: string | null }[] }
  status: string
  edited: boolean
  est_cost_usd: number | string | null
  decided_by_name: string | null
  decided_at: string | null
  reject_note: string | null
  withdrawn_reason: string | null
  sent_at: string | null
  error: string | null
  expires_at: string
  created_at: string
  replied_at: string | null
  reply_kind: string | null
  reply_snippet: string | null
}

const REPLY_LABEL: Record<string, string> = {
  reply: 'They replied (sent to Office Alerts)',
  declined: 'They said no thanks',
  opted_out: 'They opted out',
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent',
  sending: 'Sending',
  rejected: 'Turned down',
  withdrawn: 'Not sent',
  expired: 'Expired',
  failed: 'Failed',
}
const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-emerald-500/15 text-emerald-300',
  sending: 'bg-sky-500/15 text-sky-300',
  rejected: 'bg-white/5 text-white/60',
  withdrawn: 'bg-amber-500/15 text-amber-300',
  expired: 'bg-white/5 text-white/50',
  failed: 'bg-red-500/15 text-red-300',
}

function when(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  )
}

function money(v: number | string | null): string {
  const n = Number(v)
  return v === null || v === '' || !Number.isFinite(n) ? '' : `$${n.toFixed(n < 0.1 ? 3 : 2)}`
}

export default function GaryEmailsSection({
  pending,
  customerSending,
  recent,
  isApprover,
  sentToday,
  dailyCap,
  serviceLabel,
  hasBot,
  readyByEmail,
  readyByText,
  onChanged,
}: {
  pending: GaryQueueItem[]
  customerSending: boolean
  recent: GaryQueueItem[]
  isApprover: boolean
  sentToday: number
  dailyCap: number
  serviceLabel: Map<string, string>
  hasBot: boolean
  readyByEmail: number
  readyByText: number
  onChanged: () => Promise<void>
}) {
  const [count, setCount] = useState(5)
  const [channel, setChannel] = useState<'email' | 'text'>('email')
  const what = channel === 'text' ? 'text' : 'email'
  const ready = channel === 'text' ? readyByText : readyByEmail
  const [drafting, setDrafting] = useState(false)
  const [draftMsg, setDraftMsg] = useState('')
  const [showRecent, setShowRecent] = useState(false)
  const [flash, setFlash] = useState('')

  async function cardDone(message: string) {
    setFlash(message)
    await onChanged()
  }

  async function draft() {
    setDrafting(true)
    setDraftMsg(`Gary is writing ${count} ${what}${count === 1 ? '' : 's'}. This takes up to a minute…`)
    try {
      const res = await fetch('/api/admin/gary-account/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count, channel }),
      })
      const j = (await res.json().catch(() => null)) as {
        drafted?: number
        skipped?: { name: string; why: string }[]
        costUsd?: number
        error?: string
      } | null
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`)
      const parts = [`Gary wrote ${j?.drafted ?? 0} ${what}${j?.drafted === 1 ? '' : 's'}`]
      if (j?.costUsd) parts[0] += ` (about ${money(j.costUsd)})`
      if (j?.skipped?.length) parts.push(j.skipped.map((s) => `${s.name}: ${s.why}`).join('; '))
      setDraftMsg(parts.join('. ') + '.')
      await onChanged()
    } catch (e) {
      setDraftMsg(e instanceof Error ? e.message : 'Gary couldn’t write just now.')
    } finally {
      setDrafting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-white/70">Gary&apos;s emails &amp; texts</p>
        <p className="text-xs text-white/40">
          Sent today: {sentToday} of {dailyCap}
        </p>
      </div>

      {!isApprover && (
        <p className="text-xs text-amber-300/80">
          You can see Gary&apos;s messages but you aren&apos;t one of his approvers, so you can&apos;t send or turn
          them down. Approvers are picked below.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
        <span>Have Gary write the next</span>
        <select
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="bg-transparent border border-white/15 rounded px-2 py-1 text-sm"
          disabled={drafting}
        >
          {[1, 3, 5, 10].map((n) => (
            <option key={n} value={n} className="bg-gray-900">
              {n}
            </option>
          ))}
        </select>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value === 'text' ? 'text' : 'email')}
          className="bg-transparent border border-white/15 rounded px-2 py-1 text-sm"
          disabled={drafting}
        >
          <option value="email" className="bg-gray-900">
            email{count === 1 ? '' : 's'}
          </option>
          <option value="text" className="bg-gray-900">
            text{count === 1 ? '' : 's'}
          </option>
        </select>
        <button
          type="button"
          onClick={() => void draft()}
          disabled={drafting || !hasBot || ready === 0}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {drafting ? 'Writing…' : 'Write'}
        </button>
        <span className="text-xs text-white/40">
          {ready} people ready for {channel === 'text' ? 'a text' : 'an email'}
        </span>
      </div>
      {draftMsg && <p className="text-xs text-white/60">{draftMsg}</p>}
      <p className="text-xs text-white/40">
        Writing sends nothing. Each message waits here for an approver; ones nobody decides on expire after 7 days.
        Texts only go to people we&apos;ve texted before from Txt, into that same thread.
      </p>

      {flash && <p className="text-xs text-emerald-300/90">{flash}</p>}
      {pending.length === 0 ? (
        <p className="text-xs text-white/40">Nothing waiting.</p>
      ) : (
        <div className="space-y-3">
          {pending.map((item) => (
            <PendingCard
              key={item.id}
              item={item}
              canDecide={isApprover}
              canSend={customerSending}
              serviceLabel={serviceLabel}
              onDone={cardDone}
            />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowRecent((v) => !v)} className="text-xs text-sky-400 hover:underline">
            {showRecent ? 'Hide' : 'Show'} recent decisions ({recent.length})
          </button>
          {showRecent && (
            <div className="divide-y divide-white/5 border border-white/10 rounded-lg">
              {recent.map((r) => (
                <div key={r.id} className="p-3 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-white">
                      {r.to_name || r.to_email || r.to_phone}{' '}
                      <span className="text-white/40 text-xs">· {r.channel === 'text' ? 'Text' : r.subject}</span>
                    </span>
                    <span className={`text-xs rounded px-2 py-0.5 ${STATUS_STYLE[r.status] ?? 'bg-white/5 text-white/60'}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <p className="text-xs text-white/40">
                    {[
                      r.decided_by_name && `${r.status === 'rejected' ? 'Turned down' : 'Approved'} by ${r.decided_by_name}`,
                      when(r.sent_at || r.decided_at || r.created_at),
                      r.edited && 'edited before sending',
                      r.reject_note && `“${r.reject_note}”`,
                      r.withdrawn_reason && `Not sent: ${r.withdrawn_reason}`,
                      r.error && `Error: ${r.error}`,
                      r.reply_kind && `${REPLY_LABEL[r.reply_kind] ?? 'Replied'}${r.replied_at ? ` ${when(r.replied_at)}` : ''}`,
                      r.reply_snippet && `“${r.reply_snippet.slice(0, 140)}”`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PendingCard({
  item,
  canDecide,
  canSend,
  serviceLabel,
  onDone,
}: {
  item: GaryQueueItem
  canDecide: boolean
  canSend: boolean
  serviceLabel: Map<string, string>
  onDone: (message: string) => Promise<void>
}) {
  const [subject, setSubject] = useState(item.subject)
  const [body, setBody] = useState(item.body)
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const isText = item.channel === 'text'
  const edited = subject !== item.subject || body !== item.body

  async function sendTest() {
    setBusy(true)
    setMsg(item.channel === 'text' ? 'Sending this text to your Hub DMs…' : 'Sending this draft to your own email…')
    try {
      const res = await fetch(`/api/admin/gary-account/queue/${item.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'test', subject, body }),
      })
      const j = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
      setMsg(res.ok ? j?.message || 'Test sent.' : j?.error || `Failed (${res.status})`)
    } catch {
      setMsg('The test didn’t send.')
    } finally {
      setBusy(false)
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true)
    setMsg(decision === 'approve' ? 'Checking them once more and sending…' : 'Saving…')
    try {
      const res = await fetch(`/api/admin/gary-account/queue/${item.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(decision === 'approve' ? { decision, subject, body } : { decision, note }),
      })
      const j = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`)
      setMsg('')
      await onDone(j?.message || 'Done.')
    } catch (e) {
      // A refusal (opted out since, daily limit…) — the card may now be gone, so
      // say it at the top too.
      const m = e instanceof Error ? e.message : 'That didn’t work.'
      setMsg(m)
      await onDone(m)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-white">
          {isText ? 'Text to' : 'To'} {item.to_name ? `${item.to_name} ` : ''}
          <span className="text-white/50">{isText ? item.to_phone : `<${item.to_email}>`}</span>
        </p>
        <p className="text-xs text-white/40">
          {(item.context.services ?? []).map((s) => serviceLabel.get(s) ?? s).join(' · ')}
          {item.est_cost_usd != null && ` · written for ${money(item.est_cost_usd)}`}
        </p>
      </div>
      {(item.context.sources ?? []).length > 0 && (
        <ul className="space-y-0.5">
          {(item.context.sources ?? []).map((s) => (
            <li key={`${s.kind}-${s.id}`} className="text-xs text-white/40">
              Why: {s.kind === 'lead' ? 'Lead' : 'Quote'}
              {s.date ? `, ${when(s.date).split(',')[0]}` : ''}: {s.detail}
            </li>
          ))}
        </ul>
      )}
      {!isText && (
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={!canDecide || busy}
        className="w-full bg-transparent border border-white/15 rounded px-2 py-1.5 text-sm text-white"
        aria-label="Subject"
      />
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!canDecide || busy}
        rows={Math.min(14, Math.max(6, body.split('\n').length + 2))}
        className="w-full bg-transparent border border-white/15 rounded px-2 py-1.5 text-sm text-white leading-relaxed"
        aria-label="Message"
      />
      <p className="text-xs text-white/40">
        {isText
          ? `${body.length} characters. Txt adds “- Gary, Heroes Lawn Care” when it sends, into the thread we’ve texted them from before. A reply lands in Txt and Office Alerts; Amber stays out of it.`
          : 'Gary’s sign-off and an unsubscribe line with your address are added when it sends. It goes out from the team mailbox; a reply lands in the Inbox Queue and Office Alerts.'}
      </p>
      {canDecide && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void decide('approve')}
            disabled={busy || !canSend}
            title={canSend ? undefined : 'Sending to customers is switched off above'}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {edited ? 'Approve my version & send' : 'Approve & send'}
          </button>
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={busy}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:text-white disabled:opacity-40"
          >
            Send me a test
          </button>
          {!rejecting ? (
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={busy}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:text-white disabled:opacity-40"
            >
              Turn down
            </button>
          ) : (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why? (optional)"
                className="bg-transparent border border-white/15 rounded px-2 py-1.5 text-sm text-white min-w-0 flex-1 sm:flex-none sm:w-56"
              />
              <button
                type="button"
                onClick={() => void decide('reject')}
                disabled={busy}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:text-white disabled:opacity-40"
              >
                Turn down
              </button>
              <button type="button" onClick={() => setRejecting(false)} className="text-xs text-white/40 hover:text-white">
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {msg && <p className="text-xs text-white/60">{msg}</p>}
      {rejecting && (
        <p className="text-xs text-white/40">Turned down means Gary never writes to this person again.</p>
      )}
    </div>
  )
}
