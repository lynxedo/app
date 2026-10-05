'use client'

import { useState } from 'react'
import { fmtReportDate, type FullReport } from './AfterServiceForm'

// Work Orders Phase 3 — the tech's Send button for a saved after-service report
// (Ben, Oct 5 2026: "a button to send the report via email, text or both").
// Nothing sends on its own; the tech picks the channel and taps Send. Used on
// the stop (StopServiceReport) and on the customer file (AfterServiceSection).

export type ReportContact = { phone: string | null; email: string | null; doNotText: boolean }

type Via = 'text' | 'email' | 'both'

function fmtPhone(p: string): string {
  const d = p.replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p
}

export default function SendReportPanel({ contactId, report, contact, onSent }: {
  contactId: string
  report: FullReport
  contact: ReportContact | null
  /** Called after at least one channel went out, with the customer link. */
  onSent: (r: { sentVia: string[]; url: string }) => void
}) {
  const canText = !!contact?.phone && !contact.doNotText
  const canEmail = !!contact?.email
  const [via, setVia] = useState<Via | null>(canText && canEmail ? 'both' : canText ? 'text' : canEmail ? 'email' : null)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  if (report.status !== 'final') return null

  async function send() {
    if (!via || sending) return
    setSending(true); setMsg(null)
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/service-reports/${report.id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ via: via === 'both' ? ['text', 'email'] : [via] }),
      })
      const j = await res.json().catch(() => ({}))
      if (j.sent?.length > 0) {
        const what = j.sent.length === 2 ? 'by text and email' : j.sent[0] === 'text' ? 'by text' : 'by email'
        setMsg({ ok: true, text: `✓ Sent ${what}${j.error ? ` — but ${j.error}` : ''}` })
        onSent({ sentVia: Array.from(new Set([...(report.sentVia ?? []), ...j.sent])), url: j.url })
      } else {
        setMsg({ ok: false, text: j.error || 'Could not send the report' })
      }
    } catch {
      setMsg({ ok: false, text: 'Could not send the report' })
    } finally { setSending(false) }
  }

  const opt = (v: Via, label: string, enabled: boolean) => (
    <button key={v} type="button" disabled={!enabled} onClick={() => setVia(v)}
      className={`flex-1 min-h-[44px] text-[13px] rounded-md border ${via === v ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-white/15 text-white/70'} disabled:opacity-30`}>
      {label}
    </button>
  )

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-emerald-100">📤 Send to the customer</div>
        {report.sentAt && (
          <div className="text-[11px] text-emerald-300">
            Sent {fmtReportDate(report.sentAt)}{report.sentVia.length ? ` · ${report.sentVia.map(v => (v === 'text' ? 'text' : 'email')).join(' + ')}` : ''}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        {opt('text', '💬 Text', canText)}
        {opt('email', '✉️ Email', canEmail)}
        {opt('both', 'Both', canText && canEmail)}
      </div>
      <div className="text-[11px] text-white/45">
        {contact?.phone ? (contact.doNotText ? 'Marked do-not-text' : `Text: ${fmtPhone(contact.phone)}`) : 'No phone on file'}
        {' · '}
        {contact?.email ? `Email: ${contact.email}` : 'No email on file'}
      </div>
      <button type="button" onClick={send} disabled={!via || sending}
        className="w-full min-h-[44px] rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white disabled:opacity-40">
        {sending ? 'Sending…' : report.sentAt ? 'Send again' : 'Send report'}
      </button>
      {msg && <div className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</div>}
      {report.shareUrl && (
        <a href={report.shareUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-[12px] text-sky-300 hover:underline">
          View the customer’s page ↗
        </a>
      )}
      <div className="text-[11px] text-white/35">The customer sees what was done, what you saw, recommendations, care instructions and photos — never product names or internal notes.</div>
    </div>
  )
}
