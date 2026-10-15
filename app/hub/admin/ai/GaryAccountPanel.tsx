'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GaryEmailsSection, { type GaryQueueItem } from './GaryEmailsSection'

// Admin → AI → Gary's account. Gary is the outbound sales agent (PRD in Drive:
// Reference/PRDs/GARY_OUTBOUND_SALES_PRD.md). Session 1 = his identity, the
// settings his list reads, and a PREVIEW of who he'd contact. Session 2 = his
// emails: he writes, an approver approves, it sends from the team mailbox.
// Settings autosave (Ben: admin toggles autosave) and the list rebuilds after.

type Channel = 'text' | 'email' | 'call'
type Source = { kind: 'lead' | 'quote'; id: string; detail: string; date: string | null; link: string | null }
type Row = {
  key: string
  name: string
  contactId: string | null
  phone: string | null
  email: string | null
  services: string[]
  sources: Source[]
  channel: Channel | null
  channelNote: string
  skip: string | null
  skipDetail: string | null
  lastTouchAt: string | null
}
type Payload = {
  bot: { id: string; name: string; hasAvatar: boolean } | null
  signature: string
  settings: { services: string[]; recentTouchDays: number; approverIds: string[]; dailyEmailCap: number }
  people: { id: string; name: string }[]
  isApprover: boolean
  sentToday: number
  pending: GaryQueueItem[]
  recent: GaryQueueItem[]
  serviceChoices: { key: string; label: string }[]
  skipLabels: Record<string, string>
  preview: {
    generatedAt: string
    recentTouchDays: number
    rows: Row[]
    counts: {
      people: number
      ready: number
      byChannel: Record<Channel, number>
      bySkip: Record<string, number>
      fromLeads: number
      fromQuotes: number
    }
  }
}

const CHANNEL_LABEL: Record<Channel, string> = { text: 'Text', email: 'Email', call: 'Call list' }
const CHANNEL_STYLE: Record<Channel, string> = {
  text: 'bg-emerald-500/15 text-emerald-300',
  email: 'bg-sky-500/15 text-sky-300',
  call: 'bg-amber-500/15 text-amber-300',
}
const DAY_CHOICES = [7, 14, 30, 60, 90]
type Filter = 'ready' | Channel | 'skipped'

function shortDate(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(iso),
  )
}

export default function GaryAccountPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('ready')
  const [skipFilter, setSkipFilter] = useState<string>('')
  const [query, setQuery] = useState('')
  const [avatarV, setAvatarV] = useState(() => Date.now())
  const [avatarMsg, setAvatarMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/gary-account', { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || String(res.status))
      setData(j as Payload)
      setLoadErr('')
      setLoading(false)
    } catch (e) {
      setLoadErr(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't load Gary's account. Refresh to try again.")
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(body: Record<string, unknown>) {
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/gary-account', {
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
    }
    setLoading(true)
    await load()
  }

  function toggleService(key: string) {
    if (!data) return
    const cur = data.settings.services
    const next = cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key]
    setData({ ...data, settings: { ...data.settings, services: next } })
    void save({ services: next })
  }

  function toggleApprover(id: string) {
    if (!data) return
    const cur = data.settings.approverIds
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    setData({ ...data, settings: { ...data.settings, approverIds: next } })
    void save({ approverIds: next })
  }

  function setCap(n: number) {
    if (!data) return
    setData({ ...data, settings: { ...data.settings, dailyEmailCap: n } })
    void save({ dailyEmailCap: n })
  }

  function setDays(n: number) {
    if (!data) return
    setData({ ...data, settings: { ...data.settings, recentTouchDays: n } })
    void save({ recentTouchDays: n })
  }

  async function uploadAvatar(file: File) {
    setAvatarMsg('Uploading…')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/gary-account/avatar', { method: 'POST', body: fd })
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(j?.error || `Upload failed (${res.status})`)
      setAvatarV(Date.now())
      setAvatarMsg('Saved.')
    } catch (e) {
      setAvatarMsg(e instanceof Error ? e.message : 'Upload failed.')
    }
  }

  const serviceLabel = useMemo(() => new Map((data?.serviceChoices ?? []).map((s) => [s.key, s.label])), [data])

  const shown = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.preview.rows.filter((r) => {
      if (filter === 'skipped') {
        if (!r.skip) return false
        if (skipFilter && r.skip !== skipFilter) return false
      } else if (r.skip) return false
      else if (filter !== 'ready' && r.channel !== filter) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, filter, skipFilter, query])

  const c = data?.preview.counts
  const skippedTotal = c ? c.people - c.ready : 0

  return (
    <section className="border border-white/10 rounded-lg p-4 space-y-5">
      <div className="flex items-start gap-3">
        {data?.bot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/profile/avatar/${data.bot.id}?v=${avatarV}`}
            alt="Gary"
            className="w-14 h-14 rounded-full object-cover border border-white/10 shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-white/10 shrink-0" />
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Gary&apos;s account</h2>
          <p className="text-xs text-white/50 mt-0.5">
            Gary is your outbound sales agent. Amber answers whoever contacts you; Gary goes back to people who asked and
            didn&apos;t buy. He sells irrigation, fertilization &amp; weed control, aeration, drainage and mosquito,
            never mowing or pet waste. He signs every message <span className="text-white/80">“{data?.signature ?? 'Gary, Heroes Lawn Care'}”</span>.
          </p>
          {data?.bot && (
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <button type="button" onClick={() => fileRef.current?.click()} className="text-sky-400 hover:underline">
                Change picture
              </button>
              {avatarMsg && <span className="text-white/40">{avatarMsg}</span>}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadAvatar(f)
                  e.target.value = ''
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100/90">
        <strong className="text-white">Nothing goes out without a person.</strong> Gary writes each email; an approver reads
        it, edits it if they like, and taps <em>Approve &amp; send</em>. It then goes out from the team mailbox. Texts and
        follow-up emails come later.
      </div>

      {loadErr && <p className="text-xs text-red-400">{loadErr}</p>}
      {!data && !loadErr && <p className="text-xs text-white/40">Building Gary&apos;s list…</p>}

      {data && (
        <>
          {!data.bot && (
            <p className="text-xs text-amber-300/80">This company has no Gary user in the Hub yet.</p>
          )}

          <GaryEmailsSection
            pending={data.pending}
            recent={data.recent}
            isApprover={data.isApprover}
            sentToday={data.sentToday}
            dailyCap={data.settings.dailyEmailCap}
            serviceLabel={serviceLabel}
            hasBot={Boolean(data.bot)}
            readyByEmail={data.preview.counts.byChannel.email}
            onChanged={async () => {
              setLoading(true)
              await load()
            }}
          />

          <div className="space-y-2">
            <p className="text-xs font-medium text-white/70">Who approves Gary&apos;s emails</p>
            {data.people.length === 0 ? (
              <p className="text-xs text-white/40">No one with AI admin access yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.people.map((p) => {
                  const on = data.settings.approverIds.includes(p.id)
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 text-sm rounded-lg border px-2.5 py-1 cursor-pointer ${on ? 'border-brand/60 text-white' : 'border-white/10 text-white/50'}`}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleApprover(p.id)} className="accent-brand" />
                      {p.name}
                    </label>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-white/40">
              Only people with AI admin access can be picked. With nobody ticked, company admins approve.
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-white/70">Daily limit</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
              Gary sends at most
              <select
                value={data.settings.dailyEmailCap}
                onChange={(e) => setCap(Number(e.target.value))}
                className="bg-transparent border border-white/15 rounded px-2 py-1 text-sm"
              >
                {[...new Set([5, 10, 20, 30, 50, data.settings.dailyEmailCap])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n} className="bg-gray-900">
                      {n}
                    </option>
                  ))}
              </select>
              emails a day from the team mailbox
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-white/70">What Gary may sell</p>
            <div className="flex flex-wrap gap-2">
              {data.serviceChoices.map((s) => {
                const on = data.settings.services.includes(s.key)
                return (
                  <label
                    key={s.key}
                    className={`flex items-center gap-2 text-sm rounded-lg border px-2.5 py-1 cursor-pointer ${on ? 'border-brand/60 text-white' : 'border-white/10 text-white/50'}`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleService(s.key)} className="accent-brand" />
                    {s.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-white/70">Leave people alone if they talked with us recently</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
              Skip anyone we texted, called or emailed with in the last
              <select
                value={data.settings.recentTouchDays}
                onChange={(e) => setDays(Number(e.target.value))}
                className="bg-transparent border border-white/15 rounded px-2 py-1 text-sm"
              >
                {[...new Set([...DAY_CHOICES, data.settings.recentTouchDays])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n} className="bg-gray-900">
                      {n} days
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-white/40">
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && 'Saved.'}
            {status === 'error' && <span className="text-red-400">{error}</span>}
          </p>

          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-white/70">Win-back list (preview)</p>
              <p className="text-xs text-white/40">
                {loading ? 'Rebuilding…' : `Built ${shortDate(data.preview.generatedAt)}`} · from {c?.fromLeads ?? 0} dead
                leads and {c?.fromQuotes ?? 0} unwon quotes
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5 text-xs">
              <FilterChip active={filter === 'ready'} onClick={() => setFilter('ready')}>
                Ready · {c?.ready ?? 0}
              </FilterChip>
              {(['text', 'email', 'call'] as Channel[]).map((ch) => (
                <FilterChip key={ch} active={filter === ch} onClick={() => setFilter(ch)}>
                  {CHANNEL_LABEL[ch]} · {c?.byChannel[ch] ?? 0}
                </FilterChip>
              ))}
              <FilterChip active={filter === 'skipped'} onClick={() => setFilter('skipped')}>
                Skipped · {skippedTotal}
              </FilterChip>
            </div>

            {filter === 'skipped' && c && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                <FilterChip active={!skipFilter} onClick={() => setSkipFilter('')}>
                  All reasons
                </FilterChip>
                {Object.entries(c.bySkip)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <FilterChip key={k} active={skipFilter === k} onClick={() => setSkipFilter(k)}>
                      {data.skipLabels[k] ?? k} · {n}
                    </FilterChip>
                  ))}
              </div>
            )}

            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              className="w-full sm:w-64 bg-transparent border border-white/15 rounded px-2 py-1.5 text-sm text-white placeholder:text-white/30"
            />

            {shown.length === 0 ? (
              <p className="text-xs text-white/40">Nobody here.</p>
            ) : (
              <div className="divide-y divide-white/5 border border-white/10 rounded-lg">
                {shown.map((r) => (
                  <div key={r.key} className="p-3 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        {r.contactId ? (
                          <a href={`/hub/contacts/${r.contactId}`} className="text-sm text-white hover:underline">
                            {r.name}
                          </a>
                        ) : (
                          <span className="text-sm text-white">{r.name}</span>
                        )}
                        {r.services.length > 0 && (
                          <span className="text-xs text-white/40 ml-2">
                            {r.services.map((s) => serviceLabel.get(s) ?? s).join(' · ')}
                          </span>
                        )}
                      </div>
                      {r.skip ? (
                        <span className="text-xs rounded px-2 py-0.5 bg-white/5 text-white/60">
                          {data.skipLabels[r.skip] ?? r.skip}
                          {r.skipDetail ? `: ${r.skipDetail}` : ''}
                        </span>
                      ) : r.channel ? (
                        <span className={`text-xs rounded px-2 py-0.5 ${CHANNEL_STYLE[r.channel]}`}>
                          {CHANNEL_LABEL[r.channel]} <span className="opacity-70">· {r.channelNote}</span>
                        </span>
                      ) : null}
                    </div>
                    <ul className="space-y-0.5">
                      {r.sources.map((s) => (
                        <li key={`${s.kind}-${s.id}`} className="text-xs text-white/50">
                          <span className="text-white/30">{s.kind === 'lead' ? 'Lead' : 'Quote'}{s.date ? `, ${shortDate(s.date)}` : ''}: </span>
                          {s.link ? (
                            <a href={s.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {s.detail}
                            </a>
                          ) : (
                            s.detail
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-white/40">
              <strong className="text-white/60">How Gary picks the channel:</strong> a text only if we&apos;ve texted
              this person before from Txt and they&apos;re not marked Do Not Text; otherwise email (never to anyone who
              unsubscribed or bounced). Someone with only a phone number goes on a call list for a person. Gary never
              calls. One person who is both a dead lead and an unwon quote shows once.
            </p>
          </div>
        </>
      )}
    </section>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 ${active ? 'border-brand bg-brand/20 text-white' : 'border-white/10 text-white/60 hover:text-white'}`}
    >
      {children}
    </button>
  )
}
