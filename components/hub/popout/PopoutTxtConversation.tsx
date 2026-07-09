'use client'

// Trimmed, self-contained txt (SMS) thread for the pop-out window.
//
// NOT a clone of the full TxtConversationView — it deliberately drops the heavy
// side features (templates, notes, assignment, contact modal, unified-inbox call
// markers, MMS upload) so it stays light inside a small floating window. What it
// keeps is the core loop: read the thread, watch it live, and send a text reply.
//
// Data + realtime mirror the in-page view so the two stay in lockstep:
//   - initial + refresh: GET /api/txt/conversations/:id
//   - live updates:      Supabase broadcast on `txt:{companyId}` (inbound/status)
//   - send:              POST /api/txt/conversations/:id/send   (text only here)
// A slow poll reconciles if a broadcast is ever dropped (broadcasts aren't
// persisted), matching the in-page view's safety net.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Message = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  media_urls: string[] | null
  status: string
  error_message: string | null
  created_at: string
  sender?: { id: string; display_name: string } | null
}

// Map a Twilio delivery code to a short plain-English reason (mirrors the
// in-page view). `hard` = won't accept texts; `soft` = transient/technical.
function friendlyDeliveryError(raw: string): { label: string; hard: boolean } {
  const code = raw.trim()
  switch (code) {
    case '30006': return { label: '🚫 Landline — can’t receive texts', hard: true }
    case '30005': return { label: '🚫 Number invalid or unreachable', hard: true }
    case '30004': return { label: '🚫 Message blocked by the carrier', hard: true }
    case '21610': return { label: '🚫 Contact opted out (texted STOP)', hard: true }
    case '30003': return { label: '⚠ Phone unreachable — may work later', hard: false }
    case '30007': return { label: '⚠ Blocked by carrier filtering', hard: false }
    case '30002': return { label: '⚠ Account issue — couldn’t send', hard: false }
  }
  if (/^\d{4,6}$/.test(code)) return { label: `Delivery failed (code ${code})`, hard: false }
  return { label: code || 'Delivery failed', hard: false }
}

function mediaSrc(mu: string): string {
  return /^https?:\/\//i.test(mu) ? mu : `/api/txt/media/${mu}`
}

function isImage(mu: string): boolean {
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp)(?:[?#]|$)/i.test(mu)
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return sameDay ? time : `${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${time}`
}

export default function PopoutTxtConversation({ id, companyId }: { id: string; companyId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  const refresh = useCallback(() => {
    return fetch(`/api/txt/conversations/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setMessages((data.messages || []) as Message[])
        setLoading(false)
      })
      .catch(() => {
        /* transient — the poll will retry */
        setLoading(false)
      })
  }, [id])

  // Initial load + realtime + slow reconcile poll. `loading` starts true and the
  // host remounts this component per thread, so there's no need to re-set it here.
  useEffect(() => {
    let cancelled = false
    // Initial load lives in a callback (not a bare effect-body call) so setState
    // stays out of the synchronous effect path.
    fetch(`/api/txt/conversations/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data) setMessages((data.messages || []) as Message[])
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })

    const supabase = createClient()
    const channel = supabase
      .channel(`txt:${companyId}`)
      .on('broadcast', { event: 'inbound' }, ({ payload }) => {
        if ((payload as { conversation_id?: string })?.conversation_id === id && !cancelled) refresh()
      })
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        if ((payload as { conversation_id?: string })?.conversation_id === id && !cancelled) refresh()
      })
      .subscribe()

    const t = setInterval(() => { if (!cancelled) refresh() }, 20000)

    return () => {
      cancelled = true
      clearInterval(t)
      supabase.removeChannel(channel)
    }
  }, [id, companyId, refresh])

  // Keep pinned to the newest message unless the user has scrolled up to read
  // history (then don't yank them back down).
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    // Optimistic bubble; the refresh() below reconciles to the stored/rendered row.
    const tempId = `temp-${id}-${messages.length}`
    setMessages((prev) => [
      ...prev,
      { id: tempId, direction: 'outbound', body, media_urls: null, status: 'sending', error_message: null, created_at: new Date().toISOString() },
    ])
    setText('')
    atBottomRef.current = true
    try {
      const res = await fetch(`/api/txt/conversations/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        setError(data?.error === 'twilio_not_configured' ? 'Twilio not configured (staging)' : data?.error || 'Send failed')
      }
    } catch {
      setError('Send failed')
    } finally {
      setSending(false)
      refresh()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Message list */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {loading && messages.length === 0 ? (
          <div className="pt-8 text-center text-sm text-white/40">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="pt-8 text-center text-sm text-white/40">No messages yet.</div>
        ) : (
          messages.map((m) => {
            const out = m.direction === 'outbound'
            const failed = m.status === 'failed' || m.status === 'undelivered'
            const err = failed && m.error_message ? friendlyDeliveryError(m.error_message) : null
            return (
              <div key={m.id} className={`flex flex-col ${out ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    out ? 'bg-sky-600 text-white' : 'bg-white/10 text-white'
                  } ${m.status === 'sending' ? 'opacity-60' : ''}`}
                >
                  {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                  {(m.media_urls ?? []).map((mu, i) =>
                    isImage(mu) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={mediaSrc(mu)} alt="attachment" className="mt-1 max-h-48 rounded-lg" />
                    ) : (
                      <a key={i} href={mediaSrc(mu)} target="_blank" rel="noreferrer" className="mt-1 block text-xs underline">
                        Attachment
                      </a>
                    )
                  )}
                </div>
                <div className={`mt-0.5 text-[10px] ${err?.hard ? 'text-red-300' : err ? 'text-amber-300' : 'text-white/40'}`}>
                  {err ? err.label : formatTime(m.created_at)}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Composer — text only in the pop-out (media send stays on the full page) */}
      <div className="flex-none border-t border-white/10 p-2">
        {error && <div className="px-1 pb-1 text-xs text-red-300">{error}</div>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            rows={1}
            placeholder="Text message…"
            className="max-h-28 min-h-[38px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-sky-600 text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
            aria-label="Send"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
