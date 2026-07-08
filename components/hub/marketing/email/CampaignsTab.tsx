'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'
import { type EmailDesign, emptyDesign, normalizeDesign } from '@/lib/email-blocks'
import BlockEditor from '@/components/hub/marketing/email/BlockEditor'

type Filter = { has_tag?: string[]; missing_tag?: string[]; has_line_item?: string[]; missing_line_item?: string[] }
type Template = { id: string; name: string; subject: string; design: EmailDesign }
type Segment = { id: string; name: string; filter: Filter }
type Identity = { id: string; label: string; from_name: string | null; from_email: string; is_default: boolean }

// Audience spec persisted on the campaign (mirrors lib/email-campaigns AudienceSpec).
type AudienceSpec = {
  everyone?: boolean
  segment_ids?: string[]
  contact_ids?: string[]
  extra_emails?: string[]
  excluded_ids?: string[]
}

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

// Full draft detail (from GET /campaigns/[id]) used to reopen the composer.
type CampaignDetail = Campaign & {
  design: EmailDesign | null
  audience: AudienceSpec | null
  template_id: string | null
  identity_id: string | null
  throttle_per_min: number
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

// Split a free-text box of addresses (newlines / commas / semicolons / spaces).
function parseEmails(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]
}

// ISO timestamp → the value a <input type="datetime-local"> expects (local zone).
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export default function CampaignsTab() {
  const toast = useToast()
  const confirm = useConfirm()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [editDraft, setEditDraft] = useState<CampaignDetail | null>(null)
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

  async function openDraft(c: Campaign) {
    const res = await fetch(`${BASE}/${c.id}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.campaign) { toast.error(data.error || 'Could not open the draft.'); return }
    setEditDraft(data.campaign as CampaignDetail)
  }

  async function cancelOrDelete(c: Campaign) {
    const active = c.status === 'queued' || c.status === 'processing'
    const msg = active
      ? `Stop “${c.name}”? Recipients not yet sent will be skipped.`
      : c.status === 'draft'
        ? `Delete the draft “${c.name}”?`
        : `Remove “${c.name}” from the list?`
    if (!(await confirm({ message: msg, confirmText: active ? 'Stop sending' : c.status === 'draft' ? 'Delete' : 'Remove', danger: true }))) return
    const res = await fetch(`${BASE}/${c.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(active ? 'Campaign stopped.' : c.status === 'draft' ? 'Draft deleted.' : 'Campaign removed.')
      load()
    } else {
      toast.error('Could not update the campaign.')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">Build an email and send it to segments, picked contacts, or typed-in addresses.</p>
        <Button onClick={() => setComposing(true)}>+ New campaign</Button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet — start one, pick who gets it, and send (or save it as a draft)." />
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => {
            const pct = c.recipient_count ? Math.round(((c.sent_count + c.failed_count + c.skipped_count) / c.recipient_count) * 100) : 0
            const isDraft = c.status === 'draft'
            return (
              <li key={c.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={'text-xs px-2 py-0.5 rounded-full border ' + STATUS_STYLE[c.status]}>{c.status}</span>
                      <span className="font-medium text-gray-100 truncate">{c.name}</span>
                    </div>
                    <div className="text-sm text-gray-400 truncate mt-0.5">{c.subject || <span className="text-gray-600 italic">No subject yet</span>}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {isDraft ? (
                        'Draft — not sent'
                      ) : (
                        <>
                          {c.recipient_count} recipient{c.recipient_count === 1 ? '' : 's'}
                          {' · '}{c.sent_count} sent
                          {c.failed_count ? ` · ${c.failed_count} failed` : ''}
                          {c.skipped_count ? ` · ${c.skipped_count} skipped` : ''}
                          {c.scheduled_at && c.status === 'queued' ? ` · scheduled ${fmtWhen(c.scheduled_at)}` : ''}
                          {c.status === 'complete' && c.completed_at ? ` · done ${fmtWhen(c.completed_at)}` : ''}
                        </>
                      )}
                    </div>
                    {(c.status === 'queued' || c.status === 'processing') && (
                      <div className="mt-2 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                        <div className="h-full bg-amber-400/70" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {c.last_error && <div className="text-xs text-red-400/80 mt-1">{c.last_error}</div>}
                  </div>
                  <div className="flex-none flex flex-col items-end gap-1.5">
                    {isDraft ? (
                      <button onClick={() => openDraft(c)} className="text-sm text-blue-400 hover:text-blue-300">Edit</button>
                    ) : (
                      <button onClick={() => setReportFor(c)} className="text-sm text-gray-400 hover:text-white">Report</button>
                    )}
                    <button
                      onClick={() => cancelOrDelete(c)}
                      className="text-sm text-red-400/80 hover:text-red-400"
                    >
                      {c.status === 'queued' || c.status === 'processing' ? 'Stop' : isDraft ? 'Delete' : 'Remove'}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {(composing || editDraft) && (
        <ComposeCampaign
          draft={editDraft}
          onClose={() => { setComposing(false); setEditDraft(null) }}
          onDone={() => { setComposing(false); setEditDraft(null); setLoading(true); load() }}
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

function ComposeCampaign({ draft, onClose, onDone }: { draft: CampaignDetail | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const editing = !!draft
  const [templates, setTemplates] = useState<Template[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [identities, setIdentities] = useState<Identity[]>([])

  // Which sending identity (From/domain) this campaign uses. Empty = the company
  // default (resolved server-side). Preselected to the default once loaded.
  const [identityId, setIdentityId] = useState<string>(draft?.identity_id || '')

  // Content (the campaign's own editable copy). template_id is provenance only.
  const [templateId, setTemplateId] = useState(draft?.template_id || '')
  const [subject, setSubject] = useState(draft?.subject || '')
  const [design, setDesign] = useState<EmailDesign>(draft?.design ? normalizeDesign(draft.design) : emptyDesign())
  const [name, setName] = useState(draft && draft.name ? draft.name : '')

  // Audience (composable — segments + picked contacts + typed addresses can combine).
  const a = draft?.audience || {}
  const [everyone, setEveryone] = useState(!!a.everyone)
  const [selectedSegments, setSelectedSegments] = useState<string[]>(a.segment_ids || [])
  const [picked, setPicked] = useState<string[]>(a.contact_ids || [])
  const [extraText, setExtraText] = useState((a.extra_emails || []).join('\n'))
  const [excluded, setExcluded] = useState<Set<string>>(new Set(a.excluded_ids || []))
  const [showContacts, setShowContacts] = useState((a.contact_ids || []).length > 0)

  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [contactQuery, setContactQuery] = useState('')
  const [reviewing, setReviewing] = useState(false)

  const [when, setWhen] = useState<'now' | 'later'>(draft?.scheduled_at ? 'later' : 'now')
  const [scheduledAt, setScheduledAt] = useState(draft?.scheduled_at ? toLocalInput(draft.scheduled_at) : '')

  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    (async () => {
      const [tRes, sRes, iRes] = await Promise.all([
        fetch('/api/hub/marketing/email/templates'),
        fetch('/api/hub/marketing/email/segments'),
        fetch('/api/hub/marketing/email/identities'),
      ])
      const tData = await tRes.json().catch(() => ({}))
      const sData = await sRes.json().catch(() => ({}))
      const iData = await iRes.json().catch(() => ({}))
      if (tRes.ok) setTemplates(tData.templates || [])
      if (sRes.ok) setSegments(sData.segments || [])
      if (iRes.ok) {
        const list: Identity[] = iData.identities || []
        setIdentities(list)
        // Preselect the draft's identity if it's still valid, else the company default.
        setIdentityId((cur) => {
          if (cur && list.some((i) => i.id === cur)) return cur
          return list.find((i) => i.is_default)?.id || list[0]?.id || ''
        })
      }
    })()
  }, [])

  // Lazy-load the contact list the first time the user expands manual picking.
  useEffect(() => {
    if (!showContacts || contacts !== null) return
    (async () => {
      const res = await fetch('/api/hub/marketing/email/contacts')
      const data = await res.json().catch(() => ({}))
      if (res.ok) setContacts(data.contacts || [])
      else { toast.error(data.error || 'Could not load contacts.'); setContacts([]) }
    })()
  }, [showContacts, contacts, toast])

  // Build the audience spec from the current selections.
  const buildSpec = useCallback((): AudienceSpec => ({
    everyone,
    segment_ids: everyone ? [] : selectedSegments,
    contact_ids: picked,
    extra_emails: parseEmails(extraText),
    excluded_ids: [...excluded],
  }), [everyone, selectedSegments, picked, extraText, excluded])

  const hasAudience = everyone || selectedSegments.length > 0 || picked.length > 0 || parseEmails(extraText).length > 0

  // Live combined recipient count (server resolves + de-duplicates).
  useEffect(() => {
    if (!hasAudience) { setCount(0); setCounting(false); return }
    if (debounce.current) clearTimeout(debounce.current)
    setCounting(true)
    const spec = buildSpec()
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`${BASE}/preview`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) setCount(data.count ?? 0)
      } finally {
        setCounting(false)
      }
    }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [hasAudience, buildSpec])

  // Changing the audience composition invalidates any prior recipient review.
  useEffect(() => { setExcluded(new Set()) }, [everyone, selectedSegments, picked])

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

  function toggleSegment(id: string) {
    setSelectedSegments((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])
  }
  function togglePicked(id: string) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  }

  const filteredContacts = (contacts ?? []).filter((c) => {
    const q = contactQuery.trim().toLowerCase()
    if (!q) return true
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  }).slice(0, 100)

  async function sendTest() {
    if (!design.blocks.length) { toast.error('Add some content first.'); return }
    setTesting(true)
    try {
      const res = await fetch('/api/hub/marketing/email/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, design, identity_id: identityId || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.error || 'Could not send the test.')
      else toast.success(`Test sent to ${data.sent_to}.`)
    } finally { setTesting(false) }
  }

  // Save (or update) as a draft — no recipients enqueued; reopen/edit/send later.
  async function saveDraft() {
    if (!subject.trim() && !design.blocks.length) { toast.error('Add a subject or some content before saving a draft.'); return }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        template_id: templateId || null, subject: subject.trim(), design, name: name.trim(),
        identity_id: identityId || null,
        ...buildSpec(),
      }
      if (when === 'later' && scheduledAt) payload.scheduled_at = new Date(scheduledAt).toISOString()
      const res = editing
        ? await fetch(`${BASE}/${draft!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, send: false }) })
        : await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, save_as_draft: true }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save the draft.'); return }
      toast.success('Saved as a draft.')
      onDone()
    } finally { setBusy(false) }
  }

  // Send now / schedule.
  async function send() {
    if (!subject.trim()) { toast.error('Add a subject line.'); return }
    if (!design.blocks.length) { toast.error('Add some content to the email.'); return }
    if (!hasAudience) { toast.error('Choose who gets it — a segment, picked contacts, or typed-in addresses.'); return }
    if (when === 'later' && !scheduledAt) { toast.error('Pick a date and time, or choose Send now.'); return }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        template_id: templateId || null, subject: subject.trim(), design, name: name.trim(),
        identity_id: identityId || null,
        ...buildSpec(),
      }
      if (when === 'later' && scheduledAt) payload.scheduled_at = new Date(scheduledAt).toISOString()
      const res = editing
        ? await fetch(`${BASE}/${draft!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, send: true }) })
        : await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
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
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const selectedIdentity = identities.find((i) => i.id === identityId)

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit draft' : 'New campaign'}
      maxWidth="max-w-4xl"
      fullScreenOnMobile
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <span className="text-sm text-gray-400">
            {counting ? 'Counting…' : count !== null ? <><strong className="text-white">≈ {count}</strong> recipient{count === 1 ? '' : 's'}</> : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="ghost" onClick={saveDraft} disabled={busy}>{busy ? '…' : 'Save draft'}</Button>
            <Button onClick={send} disabled={busy || !subject.trim() || !design.blocks.length || !hasAudience || count === 0}>
              {busy ? 'Working…' : when === 'later' ? 'Schedule' : 'Send now'}
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

        {/* Send from — which verified domain/From this campaign goes out on. */}
        {identities.length >= 2 && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Send from</label>
            <select
              value={identityId} onChange={(e) => setIdentityId(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
            >
              {identities.map((i) => <option key={i.id} value={i.id}>{i.label}{i.is_default ? ' · default' : ''}</option>)}
            </select>
            {selectedIdentity && (
              <p className="text-[11px] text-gray-500 mt-1">
                Sends as {selectedIdentity.from_name ? `${selectedIdentity.from_name} <${selectedIdentity.from_email}>` : selectedIdentity.from_email}
              </p>
            )}
          </div>
        )}

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

        {/* Audience — segments + picked contacts + typed addresses all combine,
            de-duplicated by email so nobody gets it twice. */}
        <div className="pt-3 border-t border-gray-800 space-y-3">
          <label className="block text-xs text-gray-400">Who gets it <span className="text-gray-600">· combine any of these — duplicates are removed automatically</span></label>

          {/* Everyone */}
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} className="accent-blue-500" />
            Everyone <span className="text-gray-500">(all subscribed contacts)</span>
          </label>

          {/* Segments */}
          {!everyone && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Segments {selectedSegments.length > 0 && <span className="text-blue-300">· {selectedSegments.length} selected</span>}</div>
              {segments.length === 0 ? (
                <p className="text-xs text-gray-600">No saved segments yet — create some in the Segments tab.</p>
              ) : (
                <div className="rounded-lg border border-gray-800 bg-gray-900 p-1.5 max-h-40 overflow-auto space-y-0.5">
                  {segments.map((s) => {
                    const on = selectedSegments.includes(s.id)
                    return (
                      <button key={s.id} onClick={() => toggleSegment(s.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/[0.04] rounded">
                        <span className={'flex-none w-4 h-4 rounded border flex items-center justify-center text-[10px] ' + (on ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-600')}>{on ? '✓' : ''}</span>
                        <span className="text-sm text-gray-200 truncate">{s.name}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Specific contacts (additive) */}
          <div>
            {!showContacts ? (
              <button onClick={() => setShowContacts(true)} className="text-sm text-blue-400 hover:text-blue-300">
                + Add specific contacts{picked.length > 0 ? ` (${picked.length})` : ''}
              </button>
            ) : contacts === null ? (
              <p className="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">Loading contacts…</p>
            ) : contacts.length === 0 ? (
              <p className="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">No subscribed contacts with an email yet.</p>
            ) : (
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-2">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs text-gray-500">Specific contacts</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{picked.length} selected</span>
                    {picked.length > 0 && <button onClick={() => setPicked([])} className="text-xs text-gray-400 hover:text-white">Clear</button>}
                    <button onClick={() => setShowContacts(false)} className="text-xs text-gray-400 hover:text-white">Hide</button>
                  </div>
                </div>
                <input
                  value={contactQuery} onChange={(e) => setContactQuery(e.target.value)}
                  placeholder="Search name or email…"
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white mb-1.5"
                />
                <ul className="max-h-48 overflow-auto divide-y divide-gray-800">
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

          {/* Typed-in addresses (not contacts) */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Other email addresses <span className="text-gray-600">· one per line or comma-separated; these aren’t saved as contacts</span></label>
            <textarea
              value={extraText} onChange={(e) => setExtraText(e.target.value)} rows={2}
              placeholder="someone@example.com, another@example.com"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white font-mono"
            />
            {parseEmails(extraText).length > 0 && <p className="text-[11px] text-gray-500 mt-1">{parseEmails(extraText).length} address{parseEmails(extraText).length === 1 ? '' : 'es'} typed.</p>}
          </div>

          {/* Review the resolved contact recipients */}
          {(everyone || selectedSegments.length > 0 || picked.length > 0) && (
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
          or suppressed is automatically skipped — even typed-in addresses, and even if they unsubscribe after this is queued.
        </p>
      </div>

      {reviewing && (
        <ReviewRecipients
          spec={buildSpec()}
          excluded={excluded}
          onClose={() => setReviewing(false)}
          onApply={(nextExcluded) => { setExcluded(nextExcluded); setReviewing(false) }}
        />
      )}
    </Modal>
  )
}

// Review the directory contacts a campaign's segments/everyone/picks resolve to,
// with a checkbox per row (all checked by default). Unchecking drops that person
// from this one send. (Typed-in addresses are managed in their own box.)
function ReviewRecipients({
  spec, excluded, onClose, onApply,
}: { spec: AudienceSpec; excluded: Set<string>; onClose: () => void; onApply: (excluded: Set<string>) => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState<Contact[]>([])
  const [local, setLocal] = useState<Set<string>>(new Set(excluded))
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${BASE}/preview`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...spec, full: true }),
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
          <span className="text-sm text-gray-400"><strong className="text-white">{keptCount}</strong> contact{keptCount === 1 ? '' : 's'} will receive it{local.size > 0 ? ` · ${local.size} excluded` : ''}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onApply(local)}>Apply</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading recipients…</p>
        ) : list.length === 0 ? (
          <EmptyState title="No subscribed contacts match this audience right now." />
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
