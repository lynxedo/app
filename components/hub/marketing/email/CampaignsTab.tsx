'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'
import { type EmailDesign, emptyDesign, normalizeDesign } from '@/lib/email-blocks'
import BlockEditor from '@/components/hub/marketing/email/BlockEditor'

type Filter = { has_tag?: string[]; missing_tag?: string[]; has_line_item?: string[]; missing_line_item?: string[] }
type Template = { id: string; name: string; subject: string; design: EmailDesign }
type Segment = { id: string; name: string; filter: Filter }
type Campaign = {
  id: string
  name: string
  subject: string
  status: 'draft' | 'queued' | 'processing' | 'complete' | 'canceled'
  recipient_count: number
  sent_count: number
  failed_count: number
  skipped_count: number
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  last_error: string | null
  created_at: string
}

const BASE = '/api/hub/marketing/email/campaigns'

const STATUS_STYLE: Record<Campaign['status'], string> = {
  draft: 'bg-gray-700/40 border-gray-600 text-gray-300',
  queued: 'bg-blue-500/15 border-blue-500/40 text-blue-300',
  processing: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
  complete: 'bg-green-500/15 border-green-500/40 text-green-300',
  canceled: 'bg-gray-700/40 border-gray-600 text-gray-400',
}

function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function CampaignsTab() {
  const toast = useToast()
  const confirm = useConfirm()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [reportFor, setReportFor] = useState<Campaign | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(BASE)
      const data = await res.json().catch(() => ({}))
      if (res.ok) setCampaigns(data.campaigns || [])
      else toast.error(data.error || 'Could not load campaigns.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  // Poll while anything is in flight so counts tick up live.
  const inFlight = campaigns.some((c) => c.status === 'queued' || c.status === 'processing')
  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(load, 12_000)
    return () => clearInterval(t)
  }, [inFlight, load])

  async function cancelOrDelete(c: Campaign) {
    const active = c.status === 'queued' || c.status === 'processing'
    const msg = active
      ? `Stop “${c.name}”? Recipients not yet sent will be skipped.`
      : `Remove “${c.name}” from the list?`
    if (!(await confirm({ message: msg, confirmText: active ? 'Stop sending' : 'Remove', danger: true }))) return
    const res = await fetch(`${BASE}/${c.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(active ? 'Campaign stopped.' : 'Campaign removed.')
      load()
    } else {
      toast.error('Could not update the campaign.')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">Build an email and send it to a segment or a hand-picked list.</p>
        <Button onClick={() => setComposing(true)}>+ New campaign</Button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet — start one from a template, customize it, and send." />
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => {
            const pct = c.recipient_count ? Math.round(((c.sent_count + c.failed_count + c.skipped_count) / c.recipient_count) * 100) : 0
            return (
              <li key={c.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={'text-xs px-2 py-0.5 rounded-full border ' + STATUS_STYLE[c.status]}>{c.status}</span>
                      <span className="font-medium text-gray-100 truncate">{c.name}</span>
                    </div>
                    <div className="text-sm text-gray-400 truncate mt-0.5">{c.subject}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {c.recipient_count} recipient{c.recipient_count === 1 ? '' : 's'}
                      {' · '}{c.sent_count} sent
                      {c.failed_count ? ` · ${c.failed_count} failed` : ''}
                      {c.skipped_count ? ` · ${c.skipped_count} skipped` : ''}
                      {c.scheduled_at && c.status === 'queued' ? ` · scheduled ${fmtWhen(c.scheduled_at)}` : ''}
                      {c.status === 'complete' && c.completed_at ? ` · done ${fmtWhen(c.completed_at)}` : ''}
                    </div>
                    {(c.status === 'queued' || c.status === 'processing') && (
                      <div className="mt-2 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                        <div className="h-full bg-amber-400/70" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {c.last_error && <div className="text-xs text-red-400/80 mt-1">{c.last_error}</div>}
                  </div>
                  <div className="flex-none flex flex-col items-end gap-1.5">
                    <button
                      onClick={() => setReportFor(c)}
                      className="text-sm text-gray-400 hover:text-white"
                    >
                      Report
                    </button>
                    <button
                      onClick={() => cancelOrDelete(c)}
                      className="text-sm text-red-400/80 hover:text-red-400"
                    >
                      {c.status === 'queued' || c.status === 'processing' ? 'Stop' : 'Remove'}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {composing && (
        <ComposeCampaign
          onClose={() => setComposing(false)}
          onSent={() => { setComposing(false); setLoading(true); load() }}
        />
      )}

      {reportFor && (
        <CampaignReport campaign={reportFor} onClose={() => setReportFor(null)} />
      )}
    </div>
  )
}

type Stats = { delivered: number; opened: number; clicked: number; bounced: number; complained: number; unsubscribed: number }
type SampleRow = { email: string; status: string; error_message: string | null; processed_at: string | null }

function CampaignReport({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [sample, setSample] = useState<SampleRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/${campaign.id}`)
        const data = await res.json().catch(() => ({}))
        if (res.ok) { setStats(data.stats || null); setSample(data.sample || []) }
      } finally {
        setLoading(false)
      }
    })()
  }, [campaign.id])

  // Rates are against delivered (the standard denominator); fall back to sent_count
  // before any delivered events have landed.
  const denom = stats && stats.delivered > 0 ? stats.delivered : campaign.sent_count
  const pct = (n: number) => (denom > 0 ? `${Math.round((n / denom) * 100)}%` : '—')

  return (
    <Modal open onClose={onClose} title={campaign.name} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="text-sm text-gray-400">{campaign.subject}</div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="Recipients" value={campaign.recipient_count} />
          <Stat label="Sent" value={campaign.sent_count} />
          <Stat label="Delivered" value={loading ? '…' : stats?.delivered ?? 0} />
          <Stat label="Opened" value={loading ? '…' : stats?.opened ?? 0} sub={loading ? '' : pct(stats?.opened ?? 0)} />
          <Stat label="Clicked" value={loading ? '…' : stats?.clicked ?? 0} sub={loading ? '' : pct(stats?.clicked ?? 0)} />
          <Stat label="Bounced" value={loading ? '…' : stats?.bounced ?? 0} tone={(stats?.bounced ?? 0) > 0 ? 'warn' : undefined} />
          <Stat label="Complaints" value={loading ? '…' : stats?.complained ?? 0} tone={(stats?.complained ?? 0) > 0 ? 'bad' : undefined} />
          <Stat label="Unsubscribed" value={loading ? '…' : stats?.unsubscribed ?? 0} />
          <Stat label="Failed / skipped" value={`${campaign.failed_count} / ${campaign.skipped_count}`} />
        </div>

        {!loading && (stats?.delivered ?? 0) === 0 && (
          <p className="text-xs text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">
            No engagement events yet. Opens, clicks, bounces, and complaints populate once the Resend
            webhook is connected (set up at prod cutover) and recipients start interacting.
          </p>
        )}

        {sample.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1.5">Recent recipients</div>
            <ul className="rounded-lg border border-gray-800 divide-y divide-gray-800 text-sm">
              {sample.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="text-gray-300 truncate">{r.email}</span>
                  <span className={
                    'flex-none text-xs px-2 py-0.5 rounded-full border ' +
                    (r.status === 'sent' ? 'bg-green-500/15 border-green-500/40 text-green-300'
                      : r.status === 'failed' ? 'bg-red-500/15 border-red-500/40 text-red-300'
                      : r.status === 'skipped' ? 'bg-gray-700/40 border-gray-600 text-gray-400'
                      : 'bg-blue-500/15 border-blue-500/40 text-blue-300')
                  }>{r.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'warn' | 'bad' }) {
  const valueCls = tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-white'
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={'text-lg font-semibold ' + valueCls}>{value}{sub ? <span className="text-xs text-gray-500 font-normal ml-1">{sub}</span> : null}</div>
    </div>
  )
}

type Contact = { id: string; name: string; email: string }

function ComposeCampaign({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [segments, setSegments] = useState<Segment[]>([])

  // Content (the campaign's own editable copy). template_id is provenance only.
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [design, setDesign] = useState<EmailDesign>(emptyDesign())
  const [name, setName] = useState('')

  // Audience
  const [audMode, setAudMode] = useState<'segment' | 'contacts'>('segment')
  const [segmentId, setSegmentId] = useState('') // '' = everyone
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [contactQuery, setContactQuery] = useState('')

  // Per-recipient review for segment/everyone mode: the resolved list (captured
  // when the user opens "Review recipients") + the ids they've unchecked to drop.
  const [reviewing, setReviewing] = useState(false)
  const [resolved, setResolved] = useState<Contact[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [scheduledAt, setScheduledAt] = useState('')

  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [sending, setSending] = useState(false)
  const [testing, setTesting] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    (async () => {
      const [tRes, sRes] = await Promise.all([
        fetch('/api/hub/marketing/email/templates'),
        fetch('/api/hub/marketing/email/segments'),
      ])
      const tData = await tRes.json().catch(() => ({}))
      const sData = await sRes.json().catch(() => ({}))
      if (tRes.ok) setTemplates(tData.templates || [])
      if (sRes.ok) setSegments(sData.segments || [])
    })()
  }, [])

  // Lazy-load the contact list the first time the user switches to manual picking.
  useEffect(() => {
    if (audMode !== 'contacts' || contacts !== null) return
    (async () => {
      const res = await fetch('/api/hub/marketing/email/contacts')
      const data = await res.json().catch(() => ({}))
      if (res.ok) setContacts(data.contacts || [])
      else { toast.error(data.error || 'Could not load contacts.'); setContacts([]) }
    })()
  }, [audMode, contacts, toast])

  // Changing the audience invalidates any prior recipient review.
  useEffect(() => { setResolved(null); setExcluded(new Set()) }, [audMode, segmentId])

  // Recipient count. Manual mode = number picked; segment mode = live preview
  // (minus anyone the user unchecked in the review list).
  useEffect(() => {
    if (audMode === 'contacts') { setCounting(false); setCount(picked.length); return }
    if (debounce.current) clearTimeout(debounce.current)
    setCounting(true)
    const seg = segments.find((s) => s.id === segmentId)
    const filter = seg ? seg.filter : {}
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/hub/marketing/email/segments/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) setCount(Math.max(0, (data.count ?? 0) - excluded.size))
      } finally {
        setCounting(false)
      }
    }, 250)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [audMode, segmentId, segments, picked, excluded])

  // Pick a template as the starting point — loads its design + subject into the
  // editor. Editing here never changes the source template.
  function startFromTemplate(id: string) {
    setTemplateId(id)
    if (!id) return // "Blank email" — keep whatever's there
    const tpl = templates.find((t) => t.id === id)
    if (tpl) {
      setDesign(normalizeDesign(tpl.design))
      setSubject(tpl.subject || '')
    }
  }

  const filteredContacts = (contacts ?? []).filter((c) => {
    const q = contactQuery.trim().toLowerCase()
    if (!q) return true
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  }).slice(0, 100)

  function togglePicked(id: string) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  }

  async function sendTest() {
    if (!design.blocks.length) { toast.error('Add some content first.'); return }
    setTesting(true)
    try {
      const res = await fetch('/api/hub/marketing/email/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, design }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.error || 'Could not send the test.')
      else toast.success(`Test sent to ${data.sent_to}.`)
    } finally { setTesting(false) }
  }

  async function send() {
    if (!subject.trim()) { toast.error('Add a subject line.'); return }
    if (!design.blocks.length) { toast.error('Add some content to the email.'); return }
    if (audMode === 'contacts' && picked.length === 0) { toast.error('Pick at least one contact.'); return }
    if (when === 'later' && !scheduledAt) { toast.error('Pick a date and time, or choose Send now.'); return }
    setSending(true)
    try {
      const payload: Record<string, unknown> = {
        template_id: templateId || null,
        subject: subject.trim(),
        design,
        name: name.trim(),
      }
      if (audMode === 'contacts') payload.contact_ids = picked
      else if (excluded.size > 0 && resolved) {
        // Segment/everyone with some recipients unchecked → send the trimmed list
        // explicitly. Still intersected with the emailable audience server-side.
        payload.contact_ids = resolved.filter((c) => !excluded.has(c.id)).map((c) => c.id)
      } else payload.segment_id = segmentId || null
      if (when === 'later' && scheduledAt) payload.scheduled_at = new Date(scheduledAt).toISOString()
      const res = await fetch(BASE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not start the campaign.'); return }
      if (Array.isArray(data.warnings) && data.warnings.length) {
        toast.error(`Queued, but heads up: ${data.warnings.join(' ')}`)
      } else {
        toast.success(
          data.scheduled_at
            ? `Scheduled to ${data.recipient_count} recipients.`
            : `Queued to ${data.recipient_count} recipients — sending now.`,
        )
      }
      onSent()
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New campaign"
      maxWidth="max-w-4xl"
      fullScreenOnMobile
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <span className="text-sm text-gray-400">
            {counting ? 'Counting…' : count !== null ? <><strong className="text-white">≈ {count}</strong> recipient{count === 1 ? '' : 's'}</> : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={send} disabled={sending || !subject.trim() || !design.blocks.length || count === 0}>
              {sending ? 'Starting…' : when === 'later' ? 'Schedule' : 'Send now'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Start from a template (optional) + test */}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-400 mb-1">Start from a template <span className="text-gray-600">· optional</span></label>
            <select
              value={templateId} onChange={(e) => startFromTemplate(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
            >
              <option value="">Blank email</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <Button variant="ghost" onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send test to myself'}</Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Subject line</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hi {{first_name}}, …"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Campaign name <span className="text-gray-600">· optional, for your records</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-named if left blank"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
          </div>
        </div>

        {/* The email composer (same editor as templates) */}
        <BlockEditor design={design} onChange={setDesign} />

        {/* Audience */}
        <div className="pt-3 border-t border-gray-800">
          <label className="block text-xs text-gray-400 mb-1.5">Who gets it</label>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setAudMode('segment')}
              className={'text-sm rounded-lg border px-3 py-1.5 ' + (audMode === 'segment' ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400')}
            >A segment</button>
            <button
              onClick={() => setAudMode('contacts')}
              className={'text-sm rounded-lg border px-3 py-1.5 ' + (audMode === 'contacts' ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400')}
            >Pick contacts</button>
          </div>

          {audMode === 'segment' ? (
            <div className="space-y-2">
              <select
                value={segmentId} onChange={(e) => setSegmentId(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
              >
                <option value="">Everyone (all subscribed contacts)</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setReviewing(true)}
                  className="text-sm rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-gray-300 hover:text-white"
                >Review recipients</button>
                {excluded.size > 0 && (
                  <span className="text-xs text-amber-300">{excluded.size} excluded
                    <button onClick={() => setExcluded(new Set())} className="ml-1.5 text-gray-400 hover:text-white underline">undo</button>
                  </span>
                )}
              </div>
            </div>
          ) : contacts === null ? (
            <p className="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">Loading contacts…</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">No subscribed contacts with an email yet.</p>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-2">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <input
                  value={contactQuery} onChange={(e) => setContactQuery(e.target.value)}
                  placeholder="Search name or email…"
                  className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white"
                />
                <span className="text-xs text-gray-500 flex-none">{picked.length} selected</span>
                {picked.length > 0 && (
                  <button onClick={() => setPicked([])} className="text-xs text-gray-400 hover:text-white flex-none">Clear</button>
                )}
              </div>
              <ul className="max-h-56 overflow-auto divide-y divide-gray-800">
                {filteredContacts.map((c) => {
                  const on = picked.includes(c.id)
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => togglePicked(c.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/[0.04] rounded"
                      >
                        <span className={'flex-none w-4 h-4 rounded border flex items-center justify-center text-[10px] ' + (on ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-600')}>{on ? '✓' : ''}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-200 truncate">{c.name}</span>
                          <span className="block text-xs text-gray-500 truncate">{c.email}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {filteredContacts.length === 0 && <li className="text-xs text-gray-600 px-2 py-2">No contacts match “{contactQuery}”.</li>}
              </ul>
              {(contacts.length > filteredContacts.length) && (
                <p className="text-[11px] text-gray-600 mt-1 px-1">Showing first {filteredContacts.length} — search to narrow.</p>
              )}
            </div>
          )}
        </div>

        {/* When */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">When</label>
          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={() => setWhen('now')}
              className={'text-sm rounded-lg border px-3 py-1.5 ' + (when === 'now' ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400')}
            >Send now</button>
            <button
              onClick={() => setWhen('later')}
              className={'text-sm rounded-lg border px-3 py-1.5 ' + (when === 'later' ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400')}
            >Schedule</button>
            {when === 'later' && (
              <input
                type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white"
              />
            )}
          </div>
        </div>

        <p className="text-xs text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">
          Each email includes a one-click unsubscribe and your mailing address (CAN-SPAM). Anyone unsubscribed
          or suppressed is automatically skipped — even if they unsubscribe after this is queued.
        </p>
      </div>

      {reviewing && (
        <ReviewRecipients
          filter={segments.find((s) => s.id === segmentId)?.filter || {}}
          excluded={excluded}
          onClose={() => setReviewing(false)}
          onApply={(nextExcluded, list) => { setExcluded(nextExcluded); setResolved(list); setReviewing(false) }}
        />
      )}
    </Modal>
  )
}

// Review the people a segment/everyone resolves to, with a checkbox per row
// (all checked by default). Unchecking drops that person from this one send.
function ReviewRecipients({
  filter, excluded, onClose, onApply,
}: { filter: Filter; excluded: Set<string>; onClose: () => void; onApply: (excluded: Set<string>, list: Contact[]) => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState<Contact[]>([])
  const [local, setLocal] = useState<Set<string>>(new Set(excluded))
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/hub/marketing/email/segments/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter, full: true }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok) setList(data.contacts || [])
        else toast.error(data.error || 'Could not load recipients.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = list.filter((c) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
  })
  const keptCount = list.length - local.size

  function toggle(id: string) {
    setLocal((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <Modal open onClose={onClose} title="Review recipients" maxWidth="max-w-lg" fullScreenOnMobile
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <span className="text-sm text-gray-400"><strong className="text-white">{keptCount}</strong> will receive it{local.size > 0 ? ` · ${local.size} excluded` : ''}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onApply(local, list)}>Apply</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading recipients…</p>
        ) : list.length === 0 ? (
          <EmptyState title="No subscribed recipients match this audience right now." />
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or email…"
                className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white"
              />
              <div className="flex-none flex gap-2 text-xs">
                <button onClick={() => setLocal(new Set())} className="text-gray-400 hover:text-white">All</button>
                <button onClick={() => setLocal(new Set(list.map((c) => c.id)))} className="text-gray-400 hover:text-white">None</button>
              </div>
            </div>
            <ul className="max-h-[55vh] overflow-auto divide-y divide-gray-800 rounded-lg border border-gray-800">
              {filtered.map((c) => {
                const on = !local.has(c.id)
                return (
                  <li key={c.id}>
                    <button onClick={() => toggle(c.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04]">
                      <span className={'flex-none w-4 h-4 rounded border flex items-center justify-center text-[10px] ' + (on ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-600')}>{on ? '✓' : ''}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-gray-200 truncate">{c.name || c.email}</span>
                        <span className="block text-xs text-gray-500 truncate">{c.email}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {filtered.length === 0 && <li className="px-3 py-3 text-xs text-gray-600">No matches for “{query}”.</li>}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}
