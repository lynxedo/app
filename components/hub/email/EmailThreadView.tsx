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
  waitedFor,
  WAITING_LABELS,
  LIGHT_SURFACE_STYLE,
  type ThreadDetail,
  type EmailMessage,
  type WaitingState,
  type InboxTag,
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
    d.thread.waiting_state || '',
    d.thread.snoozed_until || '',
    d.thread.follow_up_at || '',
    (d.thread.tags || []).join(','),
    d.messages.map((m) => m.id).join(','),
    d.notes.length,
    d.members.length,
  ].join('|')
}

// Black or white text for a tag pill, picked from the tag's hex background so the
// name stays legible whatever color an admin chose. Defaults to white if the hex
// can't be parsed.
function readableTextColor(hex: string): string {
  const h = (hex || '').replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return '#fff'
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#111827' : '#fff'
}

// Client-side ISO computations for the Snooze / Follow-up quick presets. Local
// time (setHours), then .toISOString() → the UTC instant the backend stores.
function tomorrow8am(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d.toISOString()
}
function nextMonday8am(): string {
  const d = new Date()
  // days until the NEXT Monday (today-is-Monday → +7, never 0).
  const daysUntil = ((8 - d.getDay()) % 7) || 7
  d.setDate(d.getDate() + daysUntil)
  d.setHours(8, 0, 0, 0)
  return d.toISOString()
}
function inDays8am(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(8, 0, 0, 0)
  return d.toISOString()
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
 * in this project, so each body renders inside a locked-down `sandbox` iframe.
 * `allow-scripts` MUST stay OFF — that is the invariant that blocks XSS: no inline
 * handlers, no <script>, nothing executes. NEVER add allow-scripts.
 * The reading frame adds `allow-same-origin` (WITHOUT allow-scripts) so the parent
 * can read the frame's rendered height to auto-size it — with scripts blocked the
 * framed doc is inert HTML/CSS, so same-origin only grants parent read access, not
 * any execution. Top-navigation is not granted, so the frame can't move the parent.
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
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [waitingMenuOpen, setWaitingMenuOpen] = useState(false)
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false)
  const [followUpMenuOpen, setFollowUpMenuOpen] = useState(false)
  const [busyAction, setBusyAction] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  // The admin-managed tag catalog (Phase 2). Fetched once; ids on a thread are
  // resolved against this to render chips + the Tag ▾ picker. We keep INACTIVE
  // tags too so an already-applied-but-since-retired tag still resolves to a
  // label; the picker itself only lists active ones.
  const [tagCatalog, setTagCatalog] = useState<InboxTag[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/email/tags')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setTagCatalog(Array.isArray(data.tags) ? data.tags : [])
      })
      .catch(() => {
        if (!cancelled) setTagCatalog([])
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  // A saved in-progress reply draft for this thread (resume support). We surface a
  // "Resume draft" button in the reader rather than auto-opening the composer, so
  // opening a thread to read it never hijacks the view.
  const resumeDraftMode: ComposerMode | null = detail?.myDraft
    ? detail.myDraft.kind === 'reply-all' || detail.myDraft.kind === 'forward'
      ? (detail.myDraft.kind as ComposerMode)
      : 'reply'
    : null

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

  // Add / remove a tag — POST (add) or DELETE (remove) /threads/{id}/tags { tagId },
  // then reload so the chips + picker checkmarks repaint. Mirrors runAction's
  // busy-guard; the picker stays open so multiple tags can be toggled in a row.
  async function toggleTag(tagId: string, applied: boolean) {
    if (busyAction) return
    setBusyAction(true)
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/tags`, {
        method: applied ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId }),
      })
      if (res.ok) await load()
      else toast.error("Couldn't update tags")
    } finally {
      setBusyAction(false)
    }
  }

  // Set / clear the "waiting on …" state — POST /threads/{id}/waiting
  // { waiting_state } (null clears), then reload.
  async function setWaiting(state: WaitingState | null) {
    if (busyAction) return
    setBusyAction(true)
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/waiting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waiting_state: state }),
      })
      if (res.ok) await load()
      else toast.error("Couldn't update the waiting status")
    } finally {
      setBusyAction(false)
    }
  }

  // Snooze / un-snooze — POST /threads/{id}/snooze { snoozed_until } (null
  // un-snoozes), then reload. Mirrors setWaiting's busy-guard.
  async function setSnooze(snoozedUntil: string | null) {
    if (busyAction) return
    setBusyAction(true)
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snoozed_until: snoozedUntil }),
      })
      if (res.ok) await load()
      else toast.error("Couldn't update the snooze")
    } finally {
      setBusyAction(false)
    }
  }

  // Set / clear the follow-up reminder — POST /threads/{id}/follow-up
  // { follow_up_at, follow_up_note } (null follow_up_at clears), then reload.
  async function setFollowUp(followUpAt: string | null, followUpNote: string | null) {
    if (busyAction) return
    setBusyAction(true)
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follow_up_at: followUpAt, follow_up_note: followUpNote }),
      })
      if (res.ok) await load()
      else toast.error("Couldn't update the follow-up")
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

  // Resolve this thread's applied tag ids → catalog rows for the chips (skip any
  // id not found in the catalog).
  const tagById = new Map(tagCatalog.map((t) => [t.id, t]))
  const appliedTags = (thread.tags || [])
    .map((id) => tagById.get(id))
    .filter((t): t is InboxTag => !!t)
  const waitingState = thread.waiting_state ?? null
  // Phase 3A — snooze is only "active" while its time is still in the future;
  // a past snoozed_until is a no-op (the server already un-hides it).
  const snoozedUntil = thread.snoozed_until ?? null
  const isSnoozed = !!snoozedUntil && new Date(snoozedUntil).getTime() > Date.now()
  const followUpAt = thread.follow_up_at ?? null
  const followUpNote = thread.follow_up_note ?? null

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
          existingDraft={detail.myDraft ?? null}
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

        {/* Applied tags + waiting badge (Phase 2) + snooze / follow-up (Phase 3A) */}
        {(waitingState || appliedTags.length > 0 || isSnoozed || followUpAt) && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {waitingState && (
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-800 font-medium">
                ⏳ {WAITING_LABELS[waitingState]}
                {thread.waiting_set_at ? ` · ${waitedFor(thread.waiting_set_at)}` : ''}
              </span>
            )}
            {isSnoozed && (
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-indigo-100 border border-indigo-300 text-indigo-800 font-medium">
                💤 Snoozed until {messageTime(snoozedUntil)}
              </span>
            )}
            {followUpAt && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-slate-700 font-medium"
                title={followUpNote || undefined}
              >
                ⏰ Follow-up {messageTime(followUpAt)}
              </span>
            )}
            {appliedTags.map((t) => (
              <span
                key={t.id}
                className="text-[11px] px-2 py-0.5 rounded-md font-medium border border-black/5"
                style={{ backgroundColor: t.color, color: readableTextColor(t.color) }}
                title={t.kind === 'type' ? 'Type' : 'Outcome'}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {resumeDraftMode && !isClosed && (
            <button
              type="button"
              onClick={() => setComposerMode(resumeDraftMode)}
              className="text-xs px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-[#fff] font-medium"
              title="You have an unsent reply saved on this conversation"
            >
              ✎ Resume draft
            </button>
          )}
          {permissions.canReply && !isClosed && (
            <button
              type="button"
              onClick={() => setComposerMode('reply')}
              className="text-xs px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[#fff] font-medium"
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
              className="text-xs px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[#fff] font-medium disabled:opacity-50"
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
          {permissions.canReply && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setTagMenuOpen((v) => !v)}
                disabled={busyAction}
                className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
                title="Tag this thread (type / outcome)"
              >
                🏷 Tag ▾
              </button>
              {tagMenuOpen && (
                <TagMenu
                  catalog={tagCatalog}
                  appliedIds={thread.tags || []}
                  busy={busyAction}
                  onToggle={toggleTag}
                  onClose={() => setTagMenuOpen(false)}
                />
              )}
            </div>
          )}
          {permissions.canClose && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setWaitingMenuOpen((v) => !v)}
                disabled={busyAction}
                className={`text-xs px-2.5 py-1 rounded-md border disabled:opacity-50 ${
                  waitingState
                    ? 'bg-amber-100 border-amber-300 text-amber-800 font-medium hover:bg-amber-200'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                title="Set what this thread is waiting on"
              >
                {waitingState ? `⏳ ${WAITING_LABELS[waitingState]}` : 'Waiting'} ▾
              </button>
              {waitingMenuOpen && (
                <WaitingMenu
                  current={waitingState}
                  busy={busyAction}
                  onSelect={(s) => {
                    setWaiting(s)
                    setWaitingMenuOpen(false)
                  }}
                  onClose={() => setWaitingMenuOpen(false)}
                />
              )}
            </div>
          )}
          {permissions.canClose && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSnoozeMenuOpen((v) => !v)}
                disabled={busyAction}
                className={`text-xs px-2.5 py-1 rounded-md border disabled:opacity-50 ${
                  isSnoozed
                    ? 'bg-indigo-100 border-indigo-300 text-indigo-800 font-medium hover:bg-indigo-200'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                title="Snooze this thread (hide it from active views until a set time)"
              >
                {isSnoozed ? '💤 Snoozed' : 'Snooze'} ▾
              </button>
              {snoozeMenuOpen && (
                <SnoozeMenu
                  isSnoozed={isSnoozed}
                  busy={busyAction}
                  onSelect={(iso) => {
                    setSnooze(iso)
                    setSnoozeMenuOpen(false)
                  }}
                  onClose={() => setSnoozeMenuOpen(false)}
                />
              )}
            </div>
          )}
          {permissions.canClose && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setFollowUpMenuOpen((v) => !v)}
                disabled={busyAction}
                className={`text-xs px-2.5 py-1 rounded-md border disabled:opacity-50 ${
                  followUpAt
                    ? 'bg-slate-100 border-slate-300 text-slate-700 font-medium hover:bg-slate-200'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                title="Set a follow-up reminder on this thread"
              >
                {followUpAt ? '⏰ Follow-up' : 'Follow-up'} ▾
              </button>
              {followUpMenuOpen && (
                <FollowUpMenu
                  current={followUpAt}
                  currentNote={followUpNote}
                  busy={busyAction}
                  onSet={(at, note) => {
                    setFollowUp(at, note)
                    setFollowUpMenuOpen(false)
                  }}
                  onClear={() => {
                    setFollowUp(null, null)
                    setFollowUpMenuOpen(false)
                  }}
                  onClose={() => setFollowUpMenuOpen(false)}
                />
              )}
            </div>
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

/**
 * Renders an untrusted email body in a sandboxed iframe that auto-sizes to its
 * content, so short emails don't leave a big empty box and long ones read in one
 * page scroll (no box-in-a-box). `allow-same-origin` (never allow-scripts) lets us
 * read the rendered height; re-measures on load, after images settle, and on resize.
 */
function EmailBodyFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(220)

  const measure = useCallback(() => {
    const doc = ref.current?.contentWindow?.document
    if (!doc) return
    const h = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0)
    if (h > 0) {
      setHeight((prev) => {
        const next = Math.min(Math.max(h + 8, 60), 40000)
        return Math.abs(next - prev) > 2 ? next : prev
      })
    }
  }, [])

  useEffect(() => {
    // Images/fonts load after onLoad and reflow the body — re-measure a couple times,
    // and whenever the window (and thus the frame width) changes.
    const t1 = setTimeout(measure, 300)
    const t2 = setTimeout(measure, 1200)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  return (
    <div className="rounded-md bg-white border border-gray-200 overflow-hidden">
      <iframe
        ref={ref}
        title="Email message"
        // allow-scripts stays OFF (blocks XSS). allow-same-origin is only so the parent
        // can read the height — see the file-level SECURITY note. Never add allow-scripts.
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        srcDoc={html}
        onLoad={measure}
        style={{ width: '100%', height, border: 0, background: '#fff', display: 'block' }}
      />
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
            // Untrusted external HTML — locked-down sandbox (scripts blocked). Auto-sizes
            // to content so there's no empty box / no box-in-a-box scroll. See EmailBodyFrame.
            <EmailBodyFrame html={message.body_html} />
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
            className="w-full px-2 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-[#fff] text-xs disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      )}
    </>
  )
}

/**
 * Tag ▾ dropdown (Phase 2). Lists the ACTIVE tags grouped under Type / Outcome
 * headers, sorted by sort_order; applied tags show a ✓. Clicking an applied tag
 * removes it, an unapplied one adds it — the menu stays open so several can be
 * toggled in a row. Positioned absolutely by the caller (wrap in `relative`);
 * closes on outside click, mirroring AssignMenu/ShareMenu.
 */
function TagMenu({
  catalog,
  appliedIds,
  busy,
  onToggle,
  onClose,
}: {
  catalog: InboxTag[]
  appliedIds: string[]
  busy: boolean
  onToggle: (tagId: string, applied: boolean) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const applied = new Set(appliedIds)
  const active = catalog
    .filter((t) => t.active)
    .sort((a, b) => a.sort_order - b.sort_order)
  const types = active.filter((t) => t.kind === 'type')
  const outcomes = active.filter((t) => t.kind === 'outcome')

  function group(label: string, list: InboxTag[]) {
    if (list.length === 0) return null
    return (
      <div>
        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400">
          {label}
        </div>
        {list.map((t) => {
          const isApplied = applied.has(t.id)
          return (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              onClick={() => onToggle(t.id, isApplied)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <span className="w-3.5 flex-none text-emerald-600">{isApplied ? '✓' : ''}</span>
              <span
                aria-hidden
                className="w-2.5 h-2.5 rounded-full flex-none border border-black/10"
                style={{ backgroundColor: t.color }}
              />
              <span className="truncate">{t.name}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-xl z-50 max-h-80 overflow-y-auto py-1"
    >
      {active.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-400">No tags configured</div>
      ) : (
        <>
          {group('Type', types)}
          {group('Outcome', outcomes)}
        </>
      )}
    </div>
  )
}

/**
 * Waiting ▾ selector (Phase 2). The 4 WaitingState options + a "Not waiting /
 * Clear" row; the current state shows a ✓. Positioned absolutely by the caller
 * (wrap in `relative`); closes on outside click, mirroring AssignMenu.
 */
function WaitingMenu({
  current,
  busy,
  onSelect,
  onClose,
}: {
  current: WaitingState | null
  busy: boolean
  onSelect: (state: WaitingState | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const states: WaitingState[] = ['customer', 'tech', 'vendor', 'approval']

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-xl z-50 py-1"
    >
      {states.map((s) => (
        <button
          key={s}
          type="button"
          disabled={busy}
          onClick={() => onSelect(s)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 ${
            current === s ? 'text-amber-700 font-medium' : 'text-gray-700'
          }`}
        >
          <span className="w-3.5 flex-none">{current === s ? '✓' : ''}</span>
          {WAITING_LABELS[s]}
        </button>
      ))}
      <button
        type="button"
        disabled={busy || !current}
        onClick={() => onSelect(null)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-t border-gray-100 disabled:opacity-40"
      >
        <span aria-hidden className="w-3.5 flex-none" />
        Not waiting / Clear
      </button>
    </div>
  )
}

/**
 * Snooze ▾ selector (Phase 3A). Quick presets (Later today / Tomorrow / Next
 * Monday) + a custom datetime-local, plus "Un-snooze" when already snoozed. Each
 * pick computes an ISO instant client-side and calls onSelect (null un-snoozes).
 * Positioned absolutely by the caller (wrap in `relative`); closes on outside
 * click, mirroring WaitingMenu.
 */
function SnoozeMenu({
  isSnoozed,
  busy,
  onSelect,
  onClose,
}: {
  isSnoozed: boolean
  busy: boolean
  onSelect: (iso: string | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [custom, setCustom] = useState('')

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const presets: { label: string; iso: () => string }[] = [
    { label: 'Later today (+3 hours)', iso: () => new Date(Date.now() + 3 * 3600 * 1000).toISOString() },
    { label: 'Tomorrow 8am', iso: tomorrow8am },
    { label: 'Next Monday 8am', iso: nextMonday8am },
  ]

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 w-60 bg-white border border-gray-200 rounded-md shadow-xl z-50 py-1"
    >
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          disabled={busy}
          onClick={() => onSelect(p.iso())}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <span aria-hidden>💤</span>
          {p.label}
        </button>
      ))}
      <div className="px-3 py-2 border-t border-gray-100">
        <label className="block text-[10px] uppercase tracking-wide text-gray-400 mb-1">Custom</label>
        <input
          type="datetime-local"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="w-full px-2 py-1 rounded-md border border-gray-300 text-xs text-gray-900 focus:outline-none focus:border-gray-400"
          style={{ fontSize: 16 }}
        />
        <button
          type="button"
          disabled={busy || !custom}
          onClick={() => {
            const d = new Date(custom)
            if (!isNaN(d.getTime())) onSelect(d.toISOString())
          }}
          className="mt-1.5 w-full px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-[#fff] text-xs disabled:opacity-40"
        >
          Snooze
        </button>
      </div>
      {isSnoozed && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelect(null)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-t border-gray-100 disabled:opacity-40"
        >
          <span aria-hidden className="w-3.5 flex-none" />
          Un-snooze
        </button>
      )}
    </div>
  )
}

/**
 * Follow-up popover (Phase 3A). Quick presets (Tomorrow / In 3 days / Next week)
 * + a custom datetime-local and an optional note, plus a Clear row when a
 * follow-up is already set. Positioned absolutely by the caller (wrap in
 * `relative`); closes on outside click, mirroring WaitingMenu.
 */
function FollowUpMenu({
  current,
  currentNote,
  busy,
  onSet,
  onClear,
  onClose,
}: {
  current: string | null
  currentNote: string | null
  busy: boolean
  onSet: (at: string, note: string | null) => void
  onClear: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [when, setWhen] = useState('')
  const [note, setNote] = useState(currentNote || '')

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const presets: { label: string; iso: () => string }[] = [
    { label: 'Tomorrow 8am', iso: tomorrow8am },
    { label: 'In 3 days', iso: () => inDays8am(3) },
    { label: 'Next week', iso: () => inDays8am(7) },
  ]

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-xl z-50 py-1"
    >
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          disabled={busy}
          onClick={() => onSet(p.iso(), note.trim() || null)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <span aria-hidden>⏰</span>
          {p.label}
        </button>
      ))}
      <div className="px-3 py-2 border-t border-gray-100 space-y-1.5">
        <label className="block text-[10px] uppercase tracking-wide text-gray-400">Custom time</label>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="w-full px-2 py-1 rounded-md border border-gray-300 text-xs text-gray-900 focus:outline-none focus:border-gray-400"
          style={{ fontSize: 16 }}
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="w-full px-2 py-1 rounded-md border border-gray-300 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400"
          style={{ fontSize: 16 }}
        />
        <button
          type="button"
          disabled={busy || !when}
          onClick={() => {
            const d = new Date(when)
            if (!isNaN(d.getTime())) onSet(d.toISOString(), note.trim() || null)
          }}
          className="w-full px-2 py-1 rounded-md bg-slate-600 hover:bg-slate-500 text-[#fff] text-xs disabled:opacity-40"
        >
          Set follow-up
        </button>
      </div>
      {current && (
        <button
          type="button"
          disabled={busy}
          onClick={onClear}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 border-t border-gray-100 disabled:opacity-40"
        >
          <span aria-hidden className="w-3.5 flex-none" />
          Clear follow-up
        </button>
      )}
    </div>
  )
}
