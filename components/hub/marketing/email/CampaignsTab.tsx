'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'

type Filter = { has_tag?: string[]; missing_tag?: string[] }
type Template = { id: string; name: string; subject: string }
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
        <p className="text-sm text-gray-400">Send a template to a segment as a one-off blast.</p>
        <Button onClick={() => setComposing(true)}>+ New campaign</Button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet — pick a template and a segment to send your first blast." />
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
                  <button
                    onClick={() => cancelOrDelete(c)}
                    className="flex-none text-sm text-red-400/80 hover:text-red-400"
                  >
                    {c.status === 'queued' || c.status === 'processing' ? 'Stop' : 'Remove'}
                  </button>
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
    </div>
  )
}

function ComposeCampaign({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [templateId, setTemplateId] = useState('')
  const [segmentId, setSegmentId] = useState('') // '' = everyone
  const [name, setName] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [sending, setSending] = useState(false)
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

  // Live recipient count for the chosen segment (or everyone when none picked).
  useEffect(() => {
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
        if (res.ok) setCount(data.count ?? 0)
      } finally {
        setCounting(false)
      }
    }, 250)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [segmentId, segments])

  async function send() {
    if (!templateId) { toast.error('Pick a template.'); return }
    if (when === 'later' && !scheduledAt) { toast.error('Pick a date and time, or choose Send now.'); return }
    setSending(true)
    try {
      const payload: Record<string, unknown> = {
        template_id: templateId,
        segment_id: segmentId || null,
        name: name.trim(),
      }
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
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <span className="text-sm text-gray-400">
            {counting ? 'Counting…' : count !== null ? <><strong className="text-white">≈ {count}</strong> recipient{count === 1 ? '' : 's'}</> : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={send} disabled={sending || !templateId || count === 0}>
              {sending ? 'Starting…' : when === 'later' ? 'Schedule' : 'Send now'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Template</label>
          {templates.length === 0 ? (
            <p className="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">
              No templates yet — create one in the Templates tab first.
            </p>
          ) : (
            <select
              value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.subject ? ` — ${t.subject}` : ''}</option>)}
            </select>
          )}
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Send to</label>
          <select
            value={segmentId} onChange={(e) => setSegmentId(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
          >
            <option value="">Everyone (all subscribed contacts)</option>
            {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Campaign name <span className="text-gray-600">· optional, for your records</span></label>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Auto-named from template + segment if left blank"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
          />
        </div>

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
    </Modal>
  )
}
