'use client'

// Desktop Dialer Control — Sessions 4 + 6. The matched-customer identity card +
// in-call quick actions, shared by the in-call screen (ActiveCall) and the
// floating PiP. Pure consumer of a DialerLookupMatch from the shared call state.
//
// Quick actions reuse existing send paths (no new SMS plumbing): Text and On-my-
// way go through the Txt2 find-or-create + send routes; Add note writes to the
// call row (call-log2) and optionally pushes a Jobber client note; Open in Jobber
// deep-links via the matched client's web URI.

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { DialerLookupMatch } from '@/lib/dialer-lookup'
import { StatusPill, CallerIdPill } from './IncomingCall'

const ETA_OPTIONS = [10, 15, 20, 30, 45]

export default function CallContactCard({
  contact,
  number,
  compact = false,
}: {
  contact: DialerLookupMatch | null
  number: string | null
  compact?: boolean
}) {
  const router = useRouter()
  const [panel, setPanel] = useState<'none' | 'note' | 'eta'>('none')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const targetPhone = contact?.phone || number || null
  const canText = !!targetPhone
  // Don't seed an outgoing text with a caller-ID first name — it's unverified
  // (could be a spouse / line-holder), so a "Hi <name>," greeting could be wrong.
  const firstName = contact?.nameIsCallerId ? null : contact?.name?.trim().split(/\s+/)[0] || null

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500)
  }

  async function startConversation(): Promise<string | null> {
    const res = await fetch('/api/txt/conversations/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: targetPhone,
        // Never save a carrier caller-ID guess as the contact's real name.
        name: contact?.nameIsCallerId ? undefined : contact?.name || undefined,
        jobber_client_id: contact?.jobberClientId || undefined,
      }),
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => null)
    return body?.conversation_id || null
  }

  async function handleText() {
    if (!canText || busy) return
    setBusy(true)
    const id = await startConversation()
    setBusy(false)
    if (id) router.push(`/hub/txt/${id}`)
    else flash('Could not open text thread')
  }

  async function handleOnMyWay(eta: number) {
    if (!canText || busy) return
    setBusy(true)
    setPanel('none')
    try {
      const id = await startConversation()
      if (!id) { flash('Could not send'); return }
      // Business name comes from the per-company business profile; fall back to
      // the current Heroes value on any error so the text is never left blank.
      let businessName = 'Heroes Lawn Care'
      try {
        const bp = await fetch('/api/hub/business-profile')
        if (bp.ok) {
          const j = await bp.json()
          if (typeof j?.businessName === 'string' && j.businessName.trim()) businessName = j.businessName.trim()
        }
      } catch { /* keep the Heroes fallback */ }
      const greeting = firstName ? `Hi ${firstName}, ` : ''
      const text = `${greeting}this is ${businessName} — I'm on my way, about ${eta} minutes out. See you soon!`
      const res = await fetch(`/api/txt/conversations/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      flash(res.ok ? `On-my-way text sent (${eta} min)` : 'Could not send text')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveNote() {
    const text = note.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/dialer/calls/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: text,
          toJobber: !!contact?.jobberClientId,
          jobberClientId: contact?.jobberClientId || undefined,
        }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setNote('')
        setPanel('none')
        flash(body?.jobberPosted ? 'Note saved + added to Jobber' : 'Note saved')
      } else {
        flash('Could not save note')
      }
    } finally {
      setBusy(false)
    }
  }

  const hasIdentity = !!(contact?.name || contact?.address || contact?.status)

  return (
    <div className={`w-full ${compact ? 'text-left' : 'text-left'} rounded-lg bg-white/5 border border-white/10 p-3 space-y-2`}>
      {/* Identity */}
      {hasIdentity ? (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {contact?.name && <span className="font-semibold text-white truncate">{contact.name}</span>}
            {contact?.status && <StatusPill status={contact.status} />}
            {contact?.nameIsCallerId && <CallerIdPill />}
          </div>
          {contact?.address && <div className="text-xs text-white/60 truncate mt-0.5">{contact.address}</div>}
        </div>
      ) : (
        <div className="text-xs text-white/40">No customer match for this number</div>
      )}

      {/* Quick action row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <ActionChip label="Text" onClick={handleText} disabled={!canText || busy}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 01-11.6 7.1L4 20l1-4.5A8 8 0 1121 12z" />
          </svg>
        </ActionChip>
        <ActionChip
          label="On my way"
          active={panel === 'eta'}
          onClick={() => setPanel((p) => (p === 'eta' ? 'none' : 'eta'))}
          disabled={!canText || busy}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-7h10l3 4h3v6h-2m-2 0H9m0 0a2 2 0 11-4 0m4 0a2 2 0 10-4 0m12 0a2 2 0 11-4 0m4 0a2 2 0 10-4 0" />
          </svg>
        </ActionChip>
        <ActionChip
          label="Note"
          active={panel === 'note'}
          onClick={() => setPanel((p) => (p === 'note' ? 'none' : 'note'))}
          disabled={busy}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </ActionChip>
        {contact?.jobberWebUri && (
          <a
            href={contact.jobberWebUri}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-white/5 text-white/80 hover:bg-white/10"
            title="Open in Jobber"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6m0 0v6m0-6L10 14M19 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h4" />
            </svg>
            Jobber
          </a>
        )}
      </div>

      {/* ETA picker */}
      {panel === 'eta' && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          {ETA_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleOnMyWay(m)}
              disabled={busy}
              className="px-2.5 py-1 rounded-md text-xs bg-sky-600/80 hover:bg-sky-500 text-white disabled:opacity-50"
            >
              {m} min
            </button>
          ))}
        </div>
      )}

      {/* Note box */}
      {panel === 'note' && (
        <div className="space-y-1.5 pt-1">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Note for this call…"
            className="w-full rounded-md bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/40">
              {contact?.jobberClientId ? 'Saves to the call + the Jobber client' : 'Saves to the call record'}
            </span>
            <button
              type="button"
              onClick={handleSaveNote}
              disabled={busy || !note.trim()}
              className="px-3 py-1 rounded-md text-xs bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {toast && <div className="text-[11px] text-emerald-300 pt-0.5">{toast}</div>}
    </div>
  )
}

function ActionChip({
  children,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors disabled:opacity-40 ${
        active ? 'bg-white text-gray-900' : 'bg-white/5 text-white/80 hover:bg-white/10'
      }`}
    >
      {children}
      {label}
    </button>
  )
}
