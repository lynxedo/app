'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Spinner, EmptyState, useToast } from '@/components/ui'
import AssignMenu from './AssignMenu'
import ShareMenu from './ShareMenu'
import {
  messageTime,
  participantName,
  firstName,
  fileSize,
  plainToHtml,
  type ThreadDetail,
  type EmailMessage,
} from './emailFormat'

type SuggestTone = 'professional' | 'friendly' | 'brief'
const SUGGEST_TONES: { value: SuggestTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'brief', label: 'Brief' },
]

/**
 * Full email thread view (mirrors TxtConversationView). Loads its own data from
 * GET /api/hub/email/threads/{id} and renders the message stream, internal
 * notes, a reply composer with AI helpers (Suggest / Polish), and an action bar
 * (Claim / Assign / Close / Share / Note) gated by the server `permissions`.
 *
 * SECURITY: email bodies are untrusted external HTML. There is no HTML sanitizer
 * in this project, so each body renders inside a locked-down `sandbox=""` iframe
 * (no allow-scripts, no allow-same-origin) — scripts and inline handlers can't
 * run and the frame can't touch the parent page.
 */
export default function EmailThreadView({
  threadId,
  currentUserId,
  companyId,
}: {
  threadId: string
  currentUserId: string
  companyId: string
}) {
  const toast = useToast()
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Composer.
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // AI helpers.
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishUndo, setPolishUndo] = useState<string | null>(null)

  // Action bar.
  const [assignOpen, setAssignOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [busyAction, setBusyAction] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  // Which messages are expanded (default: the most recent).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}`)
      if (res.status === 404 || res.status === 403) {
        setNotFound(true)
        return
      }
      if (!res.ok) return
      const data: ThreadDetail = await res.json()
      setDetail(data)
      // Expand the newest message by default (only on first load — don't fight
      // the user's manual toggles on later refreshes).
      setExpanded((prev) => {
        if (prev.size > 0) return prev
        const last = data.messages[data.messages.length - 1]
        return last ? new Set([last.id]) : new Set()
      })
    } finally {
      setLoading(false)
    }
  }, [threadId])

  useEffect(() => {
    load()
  }, [load])

  // Mark read on open (per-device stamp shared with the sidebar dot).
  useEffect(() => {
    try {
      const key = 'email-conv-reads'
      const map = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, string>
      map[threadId] = new Date().toISOString()
      localStorage.setItem(key, JSON.stringify(map))
    } catch {
      /* ignore */
    }
  }, [threadId, detail?.messages.length])

  // Realtime — refresh when the company inbox channel names this thread.
  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`inbox:${companyId}`)
      .on('broadcast', { event: 'update' }, ({ payload }) => {
        if ((payload as { thread_id?: string })?.thread_id === threadId) load()
      })
      .on('broadcast', { event: 'sync' }, ({ payload }) => {
        const p = payload as { thread_id?: string }
        if (!p?.thread_id || p.thread_id === threadId) load()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [threadId, companyId, load])

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function sendReply() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setSendError('')
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyHtml: plainToHtml(body) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false || data.error) {
        setSendError(data.error || 'Send failed — try again')
        return
      }
      setText('')
      setPolishUndo(null)
      await load()
      setTimeout(() => textareaRef.current?.focus(), 0)
    } catch {
      setSendError('Send failed — try again')
    } finally {
      setSending(false)
    }
  }

  async function runSuggestReply(tone: SuggestTone) {
    setSuggestOpen(false)
    if (suggestLoading) return
    setSuggestLoading(true)
    setSendError('')
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/suggest-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.reply) {
        setSendError(data.error || "Couldn't generate a suggestion — try again")
        return
      }
      const reply: string = data.reply
      if (text.trim().length > 5) {
        const ok =
          typeof window !== 'undefined' &&
          window.confirm('Replace your current draft with the suggestion?')
        if (!ok) return
      }
      setText(reply)
      setPolishUndo(null)
      setTimeout(() => textareaRef.current?.focus(), 0)
    } catch {
      setSendError("Couldn't generate a suggestion — try again")
    } finally {
      setSuggestLoading(false)
    }
  }

  async function runPolish() {
    const draft = text.trim()
    if (polishLoading || !draft) return
    setPolishLoading(true)
    setSendError('')
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/refine-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.refined) {
        setSendError(data.error || "Couldn't polish the draft — try again")
        return
      }
      const refined: string = data.refined
      if (refined.trim() === draft) return
      setPolishUndo(text)
      setText(refined)
      setTimeout(() => textareaRef.current?.focus(), 0)
    } catch {
      setSendError("Couldn't polish the draft — try again")
    } finally {
      setPolishLoading(false)
    }
  }

  function undoPolish() {
    if (polishUndo === null) return
    setText(polishUndo)
    setPolishUndo(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  // Action-bar POSTs (claim / close / reopen) — thin wrapper that reloads after.
  async function runAction(path: string) {
    if (busyAction) return
    setBusyAction(true)
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/${path}`, {
        method: 'POST',
      })
      if (res.ok) await load()
      else toast.error(`Couldn't ${path} the thread`)
    } finally {
      setBusyAction(false)
    }
  }

  async function saveNote() {
    const body = noteText.trim()
    if (!body || savingNote) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.note) {
        setDetail((prev) => (prev ? { ...prev, notes: [...prev.notes, data.note] } : prev))
        setNoteText('')
      } else {
        toast.error("Couldn't save the note")
      }
    } finally {
      setSavingNote(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner size={8} />
      </div>
    )
  }

  if (notFound || !detail) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="md:hidden px-4 py-3 border-b border-white/10">
          <Link href="/hub/email" className="text-sm text-white/60 hover:text-white">
            ‹ Inbox
          </Link>
        </div>
        <EmptyState
          size="lg"
          title="This conversation isn’t available."
          hint="It may have been closed, moved, or you no longer have access."
          action={
            <Link
              href="/hub/email"
              className="text-sm px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
            >
              Back to inbox
            </Link>
          }
        />
      </div>
    )
  }

  const { thread, messages, members, notes, permissions } = detail
  const isClosed = thread.status === 'closed'
  const subject = thread.subject || '(no subject)'
  const memberIds = members.map((m) => m.user_id)

  const statusChip = isClosed ? (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/10 text-white/50">Closed</span>
  ) : thread.assigned_to_user_id && thread.assignee_name ? (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-[var(--t-tint-success)]">
      Owner: {thread.assignee_name === null ? '—' : firstName(thread.assignee_name)}
      {thread.assigned_to_user_id === currentUserId ? ' (you)' : ''}
    </span>
  ) : (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-orange-500/20 text-[var(--t-tint-orange)]">
      Unassigned
    </span>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div
        data-hide-on-keyboard
        className="px-4 py-3 border-b border-white/10 bg-[var(--t-panel-deep)]"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href="/hub/email"
                className="md:hidden text-white/60 hover:text-white text-sm flex-none"
                aria-label="Back to inbox"
              >
                ‹
              </Link>
              <h1 className="font-medium truncate">{subject}</h1>
            </div>
            <div className="text-xs text-white/50 truncate mt-0.5">
              {participantName(thread.from_name, thread.from_email)}
              {thread.from_email && thread.from_name ? ` · ${thread.from_email}` : ''}
            </div>
          </div>
          {statusChip}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {permissions.canClaim && !isClosed && thread.assigned_to_user_id !== currentUserId && (
            <button
              type="button"
              onClick={() => runAction('claim')}
              disabled={busyAction}
              className="text-xs px-2 py-1 rounded-md bg-emerald-600/80 hover:bg-emerald-600 text-white font-medium disabled:opacity-50"
              title="Assign this to me"
            >
              Claim
            </button>
          )}
          {permissions.canAssign && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAssignOpen((v) => !v)}
                disabled={busyAction}
                className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 disabled:opacity-50"
              >
                Assign ▾
              </button>
              {assignOpen && (
                <AssignMenu
                  threadId={threadId}
                  currentAssigneeId={thread.assigned_to_user_id}
                  onAssigned={load}
                  onClose={() => setAssignOpen(false)}
                />
              )}
            </div>
          )}
          {permissions.canShare && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShareOpen((v) => !v)}
                disabled={busyAction}
                className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 disabled:opacity-50"
                title="Share this thread with a technician"
              >
                Share ▾
              </button>
              {shareOpen && (
                <ShareMenu
                  threadId={threadId}
                  existingMemberIds={memberIds}
                  onShared={load}
                  onClose={() => setShareOpen(false)}
                />
              )}
            </div>
          )}
          {permissions.canClose && (
            <button
              type="button"
              onClick={() => runAction(isClosed ? 'reopen' : 'close')}
              disabled={busyAction}
              className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 disabled:opacity-50"
            >
              {isClosed ? '↺ Reopen' : '✓ Close'}
            </button>
          )}
          {permissions.canNote && (
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 ${
                showNotes
                  ? 'bg-amber-500/20 text-[var(--t-tint-warning)]'
                  : notes.length > 0
                  ? 'bg-amber-500/10 text-[var(--t-tint-warning)] hover:bg-amber-500/20'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
              title={notes.length > 0 ? `${notes.length} internal note(s)` : 'Add internal note'}
            >
              📝
              {notes.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.1rem] px-1 rounded-full bg-amber-400/30 text-[var(--t-tint-warning)] text-[10px] font-semibold leading-none py-0.5">
                  {notes.length}
                </span>
              )}
            </button>
          )}
          {/* Members who've been shared this thread */}
          {members
            .filter((m) => m.role === 'member')
            .map((m) => (
              <span
                key={m.user_id}
                className="text-[11px] px-2 py-0.5 rounded-md bg-sky-500/15 text-[var(--t-tint-info)]"
                title={m.display_name || 'member'}
              >
                {firstName(m.display_name)}
              </span>
            ))}
        </div>
      </div>

      {/* Body: message stream + optional notes rail */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-white/40 text-sm py-8">No messages yet.</div>
          )}
          {messages.map((m) => (
            <MessageCard
              key={m.id}
              message={m}
              expanded={expanded.has(m.id)}
              onToggle={() => toggleExpanded(m.id)}
            />
          ))}

          {/* Notes shown inline on mobile (the desktop rail is hidden < md). */}
          {showNotes && (
            <div className="md:hidden pt-2">
              <NotesPanel
                notes={notes}
                canNote={permissions.canNote}
                noteText={noteText}
                setNoteText={setNoteText}
                onSave={saveNote}
                saving={savingNote}
              />
            </div>
          )}
        </div>

        {showNotes && (
          <div className="hidden md:flex flex-col w-72 border-l border-white/10 bg-[var(--t-panel-deep)] min-h-0">
            <div className="px-3 py-2 border-b border-white/10 text-xs text-[var(--t-tint-warning)]">
              Internal notes (not sent to the customer)
            </div>
            <NotesPanel
              notes={notes}
              canNote={permissions.canNote}
              noteText={noteText}
              setNoteText={setNoteText}
              onSave={saveNote}
              saving={savingNote}
            />
          </div>
        )}
      </div>

      {/* Composer */}
      {permissions.canReply && !isClosed && (
        <div className="border-t border-white/10 px-3 py-2 bg-[var(--t-panel-deep)]">
          {sendError && (
            <div className="text-xs text-[var(--t-tint-danger)] mb-1 px-1">{sendError}</div>
          )}
          {polishUndo !== null && (
            <div className="text-[11px] text-white/50 mb-1 px-1">
              ✨ Polished ·{' '}
              <button type="button" onClick={undoPolish} className="underline hover:text-white">
                undo
              </button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (polishUndo !== null) setPolishUndo(null)
            }}
            placeholder={`Reply as the shared mailbox…`}
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm resize-none min-h-[64px] max-h-[40vh]"
            style={{ fontSize: 16 }}
            disabled={sending}
          />
          <div className="flex items-center justify-between gap-2 mt-2">
            <div className="flex items-center gap-1.5">
              {/* Suggest Reply */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSuggestOpen((v) => !v)}
                  disabled={suggestLoading || messages.length === 0}
                  className="text-xs px-2 py-1 rounded-md bg-violet-500/15 text-violet-200 hover:bg-violet-500/25 disabled:opacity-60 inline-flex items-center gap-1"
                  title="Suggest a reply"
                >
                  {suggestLoading ? (
                    <span className="inline-block w-3 h-3 border-2 border-violet-200 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span aria-hidden>✨</span>
                  )}
                  <span className="hidden sm:inline">Suggest</span>
                </button>
                {suggestOpen && !suggestLoading && (
                  <div className="absolute left-0 bottom-full mb-1 w-44 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-white/40 border-b border-white/10">
                      Tone
                    </div>
                    {SUGGEST_TONES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => runSuggestReply(t.value)}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Polish */}
              <button
                type="button"
                onClick={runPolish}
                disabled={polishLoading || !text.trim()}
                className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 disabled:opacity-50 inline-flex items-center gap-1"
                title="Polish the wording of your draft"
              >
                {polishLoading ? (
                  <span className="inline-block w-3 h-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span aria-hidden>✨</span>
                )}
                <span className="hidden sm:inline">Polish</span>
              </button>
            </div>
            <button
              type="button"
              onClick={sendReply}
              disabled={sending || !text.trim()}
              className="text-sm px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Non-repliers / closed threads get a quiet footer instead of a composer. */}
      {(!permissions.canReply || isClosed) && (
        <div className="border-t border-white/10 px-4 py-3 bg-[var(--t-panel-deep)] text-xs text-white/50">
          {isClosed
            ? 'This thread is closed. Reopen it to reply.'
            : 'You can view this thread but not reply.'}
        </div>
      )}
    </div>
  )
}

/** A single email message — collapsible header + sandboxed body + attachments. */
function MessageCard({
  message,
  expanded,
  onToggle,
}: {
  message: EmailMessage
  expanded: boolean
  onToggle: () => void
}) {
  const isOutbound = message.direction === 'outbound'
  const who = isOutbound
    ? message.from_name || 'You'
    : participantName(message.from_name, message.from_email)
  const toLine = (message.to_recipients || [])
    .map((r) => r.name || r.email)
    .filter(Boolean)
    .join(', ')

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isOutbound
          ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-start justify-between gap-2 hover:bg-white/[0.03]"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {isOutbound && <span className="text-[var(--t-tint-success)]">↩ </span>}
            {who}
            {message.from_email && !isOutbound && (
              <span className="text-white/40 font-normal"> · {message.from_email}</span>
            )}
          </div>
          {toLine && (
            <div className="text-[11px] text-white/40 truncate">to {toLine}</div>
          )}
          {!expanded && message.snippet && (
            <div className="text-[11px] text-white/40 truncate mt-0.5">{message.snippet}</div>
          )}
        </div>
        <span className="text-[10px] text-white/40 flex-none whitespace-nowrap">
          {messageTime(message.message_date)}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {message.body_html ? (
            // Untrusted external HTML — locked-down iframe, no scripts, no
            // same-origin access. Fixed height + internal scroll (v1).
            <iframe
              title="Email message"
              sandbox=""
              srcDoc={message.body_html}
              className="w-full h-[420px] rounded-md bg-white border border-white/10"
            />
          ) : (
            <div className="text-sm text-white/80 whitespace-pre-wrap break-words">
              {message.snippet || '(no content)'}
            </div>
          )}

          {message.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {message.attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/70"
                  title={`${a.filename} · ${a.content_type}`}
                >
                  <span aria-hidden>📎</span>
                  <span className="max-w-[160px] truncate">{a.filename}</span>
                  <span className="text-white/40">{fileSize(a.size)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Internal-notes list + composer (shared between the desktop rail + mobile). */
function NotesPanel({
  notes,
  canNote,
  noteText,
  setNoteText,
  onSave,
  saving,
}: {
  notes: ThreadDetail['notes']
  canNote: boolean
  noteText: string
  setNoteText: (v: string) => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {notes.length === 0 && <div className="text-xs text-white/40">No notes yet.</div>}
        {notes.map((n) => (
          <div key={n.id} className="bg-amber-500/10 border border-amber-500/20 rounded-md p-2">
            <div className="text-xs whitespace-pre-wrap break-words">{n.body}</div>
            <div className="text-[10px] text-white/40 mt-1">
              {firstName(n.created_by_name) || 'Someone'} · {messageTime(n.created_at)}
            </div>
          </div>
        ))}
      </div>
      {canNote && (
        <div className="p-2 border-t border-white/10 space-y-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note (staff only)…"
            rows={2}
            className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs resize-none"
            style={{ fontSize: 16 }}
          />
          <button
            type="button"
            onClick={onSave}
            disabled={!noteText.trim() || saving}
            className="w-full px-2 py-1.5 rounded-md bg-amber-600/80 hover:bg-amber-600 text-xs disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      )}
    </>
  )
}
