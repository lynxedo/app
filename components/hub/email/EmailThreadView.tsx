'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Spinner, useToast } from '@/components/ui'
import AssignMenu from './AssignMenu'
import ShareMenu from './ShareMenu'
import EmailReplyComposer from './EmailReplyComposer'
import {
  messageTime,
  participantName,
  firstName,
  fileSize,
  attachmentMeta,
  LIGHT_SURFACE_STYLE,
  type ThreadDetail,
  type EmailMessage,
} from './emailFormat'

type ComposerMode = 'reply' | 'reply-all' | 'forward'

// A cheap "did anything meaningful change" fingerprint of a thread detail, used
// so a background poll refresh only re-renders (and only re-mounts message
// iframes) when there's an actual change — a quiet 2-min sweep with no new
// activity leaves the open thread perfectly still.
function detailSignature(d: ThreadDetail): string {
  return [
    d.thread.status,
    d.thread.assigned_to_user_id || '',
    d.thread.folder || '',
    d.messages.map((m) => m.id).join(','),
    d.notes.length,
    d.members.length,
  ].join('|')
}

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

  // Reply / Reply All / Forward — set to switch the whole main pane into a
  // full-window composer (not a split view). null = the normal reader.
  const [composerMode, setComposerMode] = useState<ComposerMode | null>(null)
  // Switching threads always drops back to the reader — adjusted during render
  // (React's recommended pattern for resetting state on a prop change) rather
  // than a useEffect, which would cause an extra render pass.
  const [composerModeForThread, setComposerModeForThread] = useState(threadId)
  if (threadId !== composerModeForThread) {
    setComposerModeForThread(threadId)
    setComposerMode(null)
  }

  // Which messages are expanded (default: the most recent).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Are we mid-compose? Realtime refreshes read this to NEVER reload the thread
  // out from under an in-progress reply (which would blow away the draft).
  const composingRef = useRef(false)
  useEffect(() => {
    composingRef.current = composerMode !== null
  }, [composerMode])

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      try {
        const res = await fetch(`/api/hub/email/threads/${threadId}`)
        if (res.status === 404 || res.status === 403) {
          setNotFound(true)
          return
        }
        if (!res.ok) return
        const data: ThreadDetail = await res.json()
        // Quiet (background poll) refresh: keep the exact same object when nothing
        // meaningful changed, so React doesn't re-render / reload the message
        // iframes — no flicker on an idle 2-min sweep. A real change swaps it in.
        if (opts?.quiet) {
          setDetail((prev) => (prev && detailSignature(prev) === detailSignature(data) ? prev : data))
        } else {
          setDetail(data)
        }
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
    },
    [threadId]
  )

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
        // A targeted change to THIS thread (someone claimed/assigned/closed/replied).
        // Refresh — but never while the user is composing (don't yank the draft).
        if ((payload as { thread_id?: string })?.thread_id === threadId && !composingRef.current) load()
      })
      .on('broadcast', { event: 'sync' }, () => {
        // Generic 2-min poll nudge (no thread id). Quietly reconcile — only
        // re-renders if a message/status actually changed — and never while
        // composing. "New mail arrived" visibility is the sidebar list's job.
        if (!composingRef.current) load({ quiet: true })
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
      <div className="email-light-surface flex-1 flex items-center justify-center bg-gray-100" style={LIGHT_SURFACE_STYLE}>
        <Spinner size={8} />
      </div>
    )
  }

  if (notFound || !detail) {
    return (
      <div className="email-light-surface flex-1 flex flex-col bg-gray-100 text-gray-900" style={LIGHT_SURFACE_STYLE}>
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
    <div className="email-light-surface flex-1 flex flex-col min-h-0 bg-gray-100 text-gray-900" style={LIGHT_SURFACE_STYLE}>
      {composerMode ? (
        <EmailReplyComposer
          mode={composerMode}
          threadId={threadId}
          thread={thread}
          messages={messages}
          emailSignature={emailSignature}
          onCancel={() => {
            setComposerMode(null)
            // Catch up on anything that changed while composing (refreshes were
            // suppressed to protect the draft).
            load({ quiet: true })
          }}
          onReplySent={async () => {
            setComposerMode(null)
            await load()
          }}
        />
      ) : (
        <>
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
          {permissions.canReply && !isClosed && (
            <button
              type="button"
              onClick={() => setComposerMode('reply')}
              className="text-xs px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              ↩ Reply
            </button>
          )}
          {permissions.canReply && !isClosed && (
            <button
              type="button"
              onClick={() => setComposerMode('reply-all')}
              className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700"
            >
              ↩↩ Reply All
            </button>
          )}
          {permissions.canReply && (
            <button
              type="button"
              onClick={() => setComposerMode('forward')}
              className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700"
            >
              ➜ Forward
            </button>
          )}
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

      {/* Quiet footer when no reply action is visible in the action bar at all. */}
      {(!permissions.canReply || isClosed) && (
        <div className="border-t border-gray-200 px-4 py-3 bg-white text-xs text-gray-500">
          {isClosed
            ? 'This thread is closed. Reopen it to reply — you can still Forward.'
            : 'You can view this thread but not reply.'}
        </div>
      )}
        </>
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
      className={`rounded-lg border overflow-hidden transition-shadow ${
        expanded
          ? `shadow-sm ${isOutbound ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200 bg-white'}`
          : `${isOutbound ? 'border-emerald-100 bg-emerald-50/25' : 'border-gray-100 bg-gray-50/60'}`
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-gray-100/70 cursor-pointer"
      >
        <span
          aria-hidden
          className={`flex-none text-gray-300 text-[10px] pt-1 transition-transform duration-150 ${
            expanded ? 'rotate-90 text-gray-400' : ''
          }`}
        >
          ▶
        </span>
        <div className="min-w-0 flex-1 flex items-start justify-between gap-2">
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
        </div>
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
