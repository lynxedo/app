'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Spinner, useToast } from '@/components/ui'
import AssignMenu from './AssignMenu'
import ShareMenu from './ShareMenu'
import EmailRichTextEditor, { type EmailEditorHandle } from './EmailRichTextEditor'
import EmailAttachments from './EmailAttachments'
import {
  messageTime,
  participantName,
  firstName,
  fileSize,
  plainToHtml,
  signatureToHtml,
  htmlToPlainText,
  textToHtmlParagraphs,
  buildQuoteHeader,
  extractDraftText,
  extractQuotedTailHtml,
  finalizeEmailHtml,
  attachmentMeta,
  type ThreadDetail,
  type EmailMessage,
  type OutgoingAttachment,
} from './emailFormat'

type SuggestTone = 'professional' | 'friendly' | 'brief'
const SUGGEST_TONES: { value: SuggestTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'brief', label: 'Brief' },
]

/**
 * Full email thread view. Loads its own data from GET /api/hub/email/threads/{id}
 * and renders the message stream, internal notes, a rich-text reply composer with
 * AI helpers (Suggest / Polish) + attachments, and an action bar (Claim / Assign /
 * Close / Share / Note) gated by the server `permissions`.
 *
 * The MAIN pane is deliberately LIGHT-themed (like a real email client) no matter
 * which Hub theme the user picked — email is read and written on white.
 *
 * SECURITY: email bodies are untrusted external HTML. There is no HTML sanitizer
 * in this project, so each body renders inside a locked-down `sandbox` iframe
 * (no allow-scripts, no allow-same-origin) — scripts and inline handlers can't
 * run and the frame can't touch the parent page. DO NOT loosen the sandbox.
 */
export default function EmailThreadView({
  threadId,
  currentUserId,
  companyId,
  emailSignature = '',
}: {
  threadId: string
  currentUserId: string
  companyId: string
  /** The signed-in user's email signature (user_profiles.email_signature). */
  emailSignature?: string
}) {
  const toast = useToast()
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

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
      <div className="flex-1 flex items-center justify-center bg-gray-100">
        <Spinner size={8} />
      </div>
    )
  }

  if (notFound || !detail) {
    return (
      <div className="flex-1 flex flex-col bg-gray-100 text-gray-900">
        <div className="md:hidden px-4 py-3 border-b border-gray-200 bg-white">
          <Link href="/hub/email" className="text-sm text-gray-500 hover:text-gray-900">
            ‹ Inbox
          </Link>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <p className="text-sm text-gray-600">This conversation isn’t available.</p>
          <p className="mt-1 text-xs text-gray-400">
            It may have been closed, moved, or you no longer have access.
          </p>
          <Link
            href="/hub/email"
            className="mt-4 text-sm px-3 py-1.5 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700"
          >
            Back to inbox
          </Link>
        </div>
      </div>
    )
  }

  const { thread, messages, members, notes, permissions } = detail
  const isClosed = thread.status === 'closed'
  const subject = thread.subject || '(no subject)'
  const memberIds = members.map((m) => m.user_id)

  const statusChip = isClosed ? (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-gray-500">
      Closed
    </span>
  ) : thread.assigned_to_user_id && thread.assignee_name ? (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700">
      Owner: {thread.assignee_name === null ? '—' : firstName(thread.assignee_name)}
      {thread.assigned_to_user_id === currentUserId ? ' (you)' : ''}
    </span>
  ) : (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-orange-50 border border-orange-200 text-orange-700">
      Unassigned
    </span>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-100 text-gray-900">
      {/* Header */}
      <div data-hide-on-keyboard className="px-4 py-3 border-b border-gray-200 bg-white max-md:pl-14">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href="/hub/email"
                className="md:hidden text-gray-400 hover:text-gray-900 text-sm flex-none"
                aria-label="Back to inbox"
              >
                ‹
              </Link>
              <h1 className="font-semibold truncate text-gray-900">{subject}</h1>
            </div>
            <div className="text-xs text-gray-500 truncate mt-0.5">
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
              className="text-xs px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
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
                className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
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
                className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
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
              className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
            >
              {isClosed ? '↺ Reopen' : '✓ Close'}
            </button>
          )}
          {permissions.canNote && (
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              className={`text-xs px-2.5 py-1 rounded-md flex items-center gap-1 border ${
                showNotes
                  ? 'bg-amber-100 border-amber-300 text-amber-800'
                  : notes.length > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
              title={notes.length > 0 ? `${notes.length} internal note(s)` : 'Add internal note'}
            >
              📝
              {notes.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.1rem] px-1 rounded-full bg-amber-200 text-amber-800 text-[10px] font-semibold leading-none py-0.5">
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
                className="text-[11px] px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-700"
                title={m.display_name || 'member'}
              >
                {firstName(m.display_name)}
              </span>
            ))}
        </div>
      </div>

      {/* Body: message stream + optional notes rail */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
          <div className="max-w-3xl mx-auto w-full space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8">No messages yet.</div>
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
        </div>

        {showNotes && (
          <div className="hidden md:flex flex-col w-72 border-l border-gray-200 bg-white min-h-0">
            <div className="px-3 py-2 border-b border-gray-200 text-xs text-amber-700 bg-amber-50">
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
        <ReplyComposer
          threadId={threadId}
          messages={messages}
          replyToName={participantName(thread.from_name, thread.from_email)}
          emailSignature={emailSignature}
          onSent={load}
        />
      )}

      {/* Non-repliers / closed threads get a quiet footer instead of a composer. */}
      {(!permissions.canReply || isClosed) && (
        <div className="border-t border-gray-200 px-4 py-3 bg-white text-xs text-gray-500">
          {isClosed
            ? 'This thread is closed. Reopen it to reply.'
            : 'You can view this thread but not reply.'}
        </div>
      )}
    </div>
  )
}

/**
 * Rich reply composer — real-email-client behavior. Pre-loads (top to bottom):
 * an empty typing area (cursor at top), the user's signature, then the quoted
 * message being replied to ("On {date}, {who} wrote:" + a styled blockquote).
 * Sends { bodyHtml, body, attachments } to POST /threads/{id}/send.
 */
function ReplyComposer({
  threadId,
  messages,
  replyToName,
  emailSignature,
  onSent,
}: {
  threadId: string
  messages: EmailMessage[]
  replyToName: string
  emailSignature: string
  onSent: () => Promise<void> | void
}) {
  const editorRef = useRef<EmailEditorHandle>(null)
  // True while WE are rewriting the document (prefill / AI apply) — so onChange
  // knows the edit didn't come from the user's keyboard.
  const programmatic = useRef(false)

  const sigHtml = signatureToHtml(emailSignature)
  const sigText = htmlToPlainText(sigHtml)

  const latestInbound = [...messages].reverse().find((m) => m.direction === 'inbound') || null

  const buildPrefill = useCallback((): string => {
    const sig = sigHtml ? `<p></p>${sigHtml}` : ''
    if (!latestInbound) return `<p></p>${sig}`
    const header = buildQuoteHeader(
      latestInbound.from_name,
      latestInbound.from_email,
      latestInbound.message_date
    )
    let inner = latestInbound.body_html || ''
    // Very large HTML bodies make the editor crawl — quote the text instead.
    if (!inner || inner.length > 150000) {
      inner = textToHtmlParagraphs(latestInbound.body_text || latestInbound.snippet || '')
    }
    return `<p></p>${sig}<p></p><p>${plainToHtml(header)}</p><blockquote>${inner}</blockquote>`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestInbound?.id, sigHtml])

  const [initialHtml] = useState(buildPrefill)
  const [draftText, setDraftText] = useState('')
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // AI helpers.
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishUndo, setPolishUndo] = useState<string | null>(null)

  function applyContent(html: string, focusStart = true) {
    programmatic.current = true
    editorRef.current?.setContent(html, { focusStart })
    programmatic.current = false
  }

  function onEditorChange(_html: string, text: string) {
    setDraftText(extractDraftText(text, sigText))
    if (!programmatic.current) setPolishUndo(null)
  }

  // When a NEW inbound arrives and the user hasn't typed anything yet, re-prefill
  // so the quote tracks the message they'll actually be answering.
  const quotedIdRef = useRef<string | null>(latestInbound?.id || null)
  useEffect(() => {
    const id = latestInbound?.id || null
    if (id === quotedIdRef.current) return
    quotedIdRef.current = id
    if (!draftText.trim()) applyContent(buildPrefill(), false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestInbound?.id])

  const canSend = !sending && (draftText.trim().length > 0 || attachments.length > 0)

  async function sendReply() {
    if (!canSend) return
    const html = editorRef.current?.getHTML() || ''
    const text = editorRef.current?.getText() || ''
    setSending(true)
    setSendError('')
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bodyHtml: finalizeEmailHtml(html),
          // Legacy plain-text fallback for the API.
          body: text,
          attachments,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false || data.error) {
        setSendError(data.error || 'Send failed — try again')
        return
      }
      setAttachments([])
      setPolishUndo(null)
      await onSent()
      // Reset to a fresh prefill (same latest inbound — we just answered it).
      applyContent(buildPrefill(), false)
      setDraftText('')
    } catch {
      setSendError('Send failed — try again')
    } finally {
      setSending(false)
    }
  }

  /** Rebuild the document with new top-area HTML, keeping signature + quote. */
  function rebuildWithTop(topHtml: string) {
    const tail = extractQuotedTailHtml(editorRef.current?.getHTML() || '')
    const sig = sigHtml ? `<p></p>${sigHtml}` : ''
    applyContent(`${topHtml}${sig}${tail ? `<p></p>${tail}` : ''}`)
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
      if (draftText.trim().length > 5) {
        const ok =
          typeof window !== 'undefined' &&
          window.confirm('Replace your current draft with the suggestion?')
        if (!ok) return
      }
      setPolishUndo(null)
      rebuildWithTop(textToHtmlParagraphs(reply))
    } catch {
      setSendError("Couldn't generate a suggestion — try again")
    } finally {
      setSuggestLoading(false)
    }
  }

  async function runPolish() {
    const draft = draftText.trim()
    if (polishLoading || !draft) return
    setPolishLoading(true)
    setSendError('')
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/refine-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.refined) {
        setSendError(data.error || "Couldn't polish the draft — try again")
        return
      }
      const refined: string = data.refined
      if (refined.trim() === draft) return
      const previous = editorRef.current?.getHTML() || ''
      rebuildWithTop(textToHtmlParagraphs(refined))
      setPolishUndo(previous)
    } catch {
      setSendError("Couldn't polish the draft — try again")
    } finally {
      setPolishLoading(false)
    }
  }

  function undoPolish() {
    if (polishUndo === null) return
    applyContent(polishUndo)
    setPolishUndo(null)
  }

  return (
    <div className="border-t border-gray-200 px-3 py-2.5 bg-white">
      <div className="max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between gap-2 mb-1 px-0.5">
          <span className="text-[11px] text-gray-400 truncate">
            Replying to {replyToName} · sends as the mailbox
          </span>
          {polishUndo !== null && (
            <span className="text-[11px] text-gray-400 flex-none">
              ✨ Polished ·{' '}
              <button
                type="button"
                onClick={undoPolish}
                className="underline hover:text-gray-700"
              >
                undo
              </button>
            </span>
          )}
        </div>
        {sendError && <div className="text-xs text-red-600 mb-1 px-0.5">{sendError}</div>}

        <EmailRichTextEditor
          ref={editorRef}
          initialHtml={initialHtml}
          onChange={onEditorChange}
          disabled={sending}
          minHeightClass="min-h-[110px]"
          maxHeightClass="max-h-[38vh]"
        />

        <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <EmailAttachments
              attachments={attachments}
              onAdd={(a) => setAttachments((prev) => [...prev, a])}
              onRemove={(id) => setAttachments((prev) => prev.filter((x) => x.id !== id))}
              disabled={sending}
            />
            {/* Suggest Reply */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSuggestOpen((v) => !v)}
                disabled={suggestLoading || messages.length === 0}
                className="text-xs px-2 py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-60 inline-flex items-center gap-1"
                title="Suggest a reply"
              >
                {suggestLoading ? (
                  <span className="inline-block w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span aria-hidden>✨</span>
                )}
                <span className="hidden sm:inline">Suggest</span>
              </button>
              {suggestOpen && !suggestLoading && (
                <div className="absolute left-0 bottom-full mb-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    Tone
                  </div>
                  {SUGGEST_TONES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => runSuggestReply(t.value)}
                      className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
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
              disabled={polishLoading || !draftText.trim()}
              className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
              title="Polish the wording of your draft"
            >
              {polishLoading ? (
                <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span aria-hidden>✨</span>
              )}
              <span className="hidden sm:inline">Polish</span>
            </button>
          </div>
          <button
            type="button"
            onClick={sendReply}
            disabled={!canSend}
            className="text-sm px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
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
      className={`rounded-lg border overflow-hidden shadow-sm ${
        isOutbound ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200 bg-white'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-start justify-between gap-2 hover:bg-gray-50/70"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium truncate text-gray-900">
            {isOutbound && <span className="text-emerald-600">↩ </span>}
            {who}
            {message.from_email && !isOutbound && (
              <span className="text-gray-400 font-normal"> · {message.from_email}</span>
            )}
          </div>
          {toLine && <div className="text-[11px] text-gray-400 truncate">to {toLine}</div>}
          {!expanded && message.snippet && (
            <div className="text-[11px] text-gray-400 truncate mt-0.5">{message.snippet}</div>
          )}
        </div>
        <span className="text-[10px] text-gray-400 flex-none whitespace-nowrap">
          {messageTime(message.message_date)}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {message.body_html ? (
            // Untrusted external HTML — locked-down iframe: NO allow-scripts / allow-same-origin
            // (so no XSS, no parent access). allow-popups(+escape) lets target=_blank links in the
            // email open in a real new tab without granting the frame any script/DOM power.
            // Fixed height + internal scroll (v1). Wrapper + frame stay white.
            <div className="rounded-md bg-white border border-gray-200 overflow-hidden">
              <iframe
                title="Email message"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={message.body_html}
                className="w-full h-[420px] bg-white"
              />
            </div>
          ) : (
            <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
              {message.snippet || '(no content)'}
            </div>
          )}

          {message.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {message.attachments.map((raw) => {
                const a = attachmentMeta(raw)
                // A just-sent outbound attachment can still be keyed by its R2 staging
                // key (contains slashes) until the next sync re-mirrors it with the
                // provider id — that isn't downloadable via the [messageId]/[attachmentId]
                // route, so show a non-clickable chip instead of a link that 404s.
                const downloadable = !!a.id && !a.id.includes('/')
                const inner = (
                  <>
                    <span aria-hidden>📎</span>
                    <span className="max-w-[160px] truncate">{a.filename}</span>
                    <span className="text-gray-400">{fileSize(a.size)}</span>
                  </>
                )
                return downloadable ? (
                  <a
                    key={a.id}
                    href={`/api/hub/email/attachments/${message.id}/${encodeURIComponent(a.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 border border-gray-200 text-[11px] text-gray-700 hover:bg-gray-100 hover:border-gray-300"
                    title={`${a.filename}${a.contentType ? ` · ${a.contentType}` : ''}`}
                  >
                    {inner}
                  </a>
                ) : (
                  <span
                    key={a.id || a.filename}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 border border-gray-200 text-[11px] text-gray-400"
                    title="Available once this message finishes syncing"
                  >
                    {inner}
                  </span>
                )
              })}
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
        {notes.length === 0 && <div className="text-xs text-gray-400">No notes yet.</div>}
        {notes.map((n) => (
          <div key={n.id} className="bg-amber-50 border border-amber-200 rounded-md p-2">
            <div className="text-xs whitespace-pre-wrap break-words text-gray-800">{n.body}</div>
            <div className="text-[10px] text-gray-400 mt-1">
              {firstName(n.created_by_name) || 'Someone'} · {messageTime(n.created_at)}
            </div>
          </div>
        ))}
      </div>
      {canNote && (
        <div className="p-2 border-t border-gray-200 space-y-2 bg-white">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note (staff only)…"
            rows={2}
            className="w-full px-2 py-1.5 rounded-md bg-white border border-gray-300 text-xs text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:border-gray-400"
            style={{ fontSize: 16 }}
          />
          <button
            type="button"
            onClick={onSave}
            disabled={!noteText.trim() || saving}
            className="w-full px-2 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      )}
    </>
  )
}
