'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { subscribeSharedBroadcast } from '@/lib/realtime-shared-channel'
import { useTabVisible } from '@/components/hub/workspace/WorkspaceTabInstance'
import { Spinner, useToast } from '@/components/ui'
import AssignMenu from './AssignMenu'
import ShareMenu from './ShareMenu'
import EmailReplyComposer from './EmailReplyComposer'
import {
  messageTime,
  dayLabel,
  fullMessageTime,
  agoLabel,
  initials,
  prepareEmailHtml,
  participantName,
  firstName,
  fileSize,
  attachmentMeta,
  waitedFor,
  WAITING_LABELS,
  LIGHT_SURFACE_STYLE,
  type ThreadDetail,
  type EmailMessage,
  type ThreadNote,
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
    // So the Customer file link appears on the next quiet sweep once the
    // counterpart is added to the directory, without a manual reload.
    d.customer?.contactId || '',
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
  // The internal-note composer at the foot of the conversation (notes themselves
  // always show in the timeline, at the moment they were written).
  const [showNotes, setShowNotes] = useState(false)
  const noteComposerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (showNotes) noteComposerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [showNotes])
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  // Phase 3B — teammates to @mention/notify when this note is posted.
  const [mentionIds, setMentionIds] = useState<string[]>([])

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

  // Mark read on open (per-device stamp shared with the sidebar dot). Skipped
  // while this is a background Workspace Tab — it's mounted but invisible, so
  // stamping here would clear the sidebar dot for mail nobody has looked at.
  // Re-runs (and stamps) as soon as the tab is brought to the front.
  const tabVisible = useTabVisible()
  useEffect(() => {
    if (!tabVisible) return
    try {
      const key = 'email-conv-reads'
      const map = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, string>
      map[threadId] = new Date().toISOString()
      localStorage.setItem(key, JSON.stringify(map))
    } catch {
      /* ignore */
    }
  }, [threadId, detail?.messages.length, tabVisible])

  // Realtime — refresh when the company inbox channel names this thread.
  useEffect(() => {
    if (!companyId) return
    // Ref-counted: the inbox sidebar subscribes to this same topic, and Supabase
    // hands both of us ONE channel object. Removing it directly here (or there)
    // killed the other's realtime — which left an Inbox thread open as a tab
    // permanently stale, since this view has no fallback poll.
    return subscribeSharedBroadcast(`inbox:${companyId}`, {
      update: (payload) => {
        // A targeted change to THIS thread (someone claimed/assigned/closed/replied).
        // Refresh — but never while the user is composing (don't yank the draft).
        if ((payload as { thread_id?: string })?.thread_id === threadId && !composingRef.current) load()
      },
      sync: () => {
        // Generic 2-min poll nudge (no thread id). Quietly reconcile — only
        // re-renders if a message/status actually changed — and never while
        // composing. "New mail arrived" visibility is the sidebar list's job.
        if (!composingRef.current) load({ quiet: true })
      },
    })
  }, [threadId, companyId, load])

  // ─── Phase 3B: collision detection (who's here / who's replying) ──────────
  // Teammate list — powers both the presence display names and the @mention
  // notify picker in the notes panel. Fetched once; bots filtered out.
  const [hubUsers, setHubUsers] = useState<{ id: string; display_name: string; is_bot?: boolean }[]>([])
  const [myName, setMyName] = useState('')
  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/users')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return
        const list: { id: string; display_name: string; is_bot?: boolean }[] = (
          Array.isArray(data.users) ? data.users : []
        ).filter((u: { is_bot?: boolean }) => !u.is_bot)
        setHubUsers(list)
        const me = list.find((u) => u.id === currentUserId)
        if (me?.display_name) setMyName(me.display_name)
      })
      .catch(() => {
        if (!cancelled) setHubUsers([])
      })
    return () => {
      cancelled = true
    }
  }, [currentUserId])

  // Resolve the current user via getUser() and fall back to email initials for the
  // presence name if we're not in hub_users. Never overwrites a real display name.
  useEffect(() => {
    let cancelled = false
    try {
      const supabase = createClient()
      supabase.auth.getUser().then(({ data }) => {
        if (cancelled) return
        const email = data.user?.email || ''
        if (email) setMyName((prev) => prev || email.split('@')[0])
      })
    } catch {
      /* auth/realtime unavailable — presence just shows a generic name */
    }
    return () => {
      cancelled = true
    }
  }, [])

  // Present users on THIS thread (ephemeral Supabase presence). Each carries a
  // display name + whether their reply composer is open.
  type PresenceMeta = { user_id: string; name: string; replying: boolean }
  const [presentUsers, setPresentUsers] = useState<PresenceMeta[]>([])
  const presenceChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const presenceSubscribedRef = useRef(false)
  // Latest name readable from the async subscribe callback.
  const myNameRef = useRef(myName)
  myNameRef.current = myName

  useEffect(() => {
    if (!threadId || !currentUserId) return
    let supabase: ReturnType<typeof createClient>
    let channel: ReturnType<ReturnType<typeof createClient>['channel']>
    try {
      supabase = createClient()
      channel = supabase.channel(`inbox:presence:${threadId}`, {
        config: { presence: { key: currentUserId } },
      })
    } catch {
      return // realtime unavailable — the collision UI simply never appears
    }
    presenceChannelRef.current = channel

    const recompute = () => {
      try {
        const state = channel.presenceState() as Record<string, Partial<PresenceMeta>[]>
        const flat: PresenceMeta[] = Object.keys(state).map((key) => {
          const metas = state[key] || []
          const meta = metas[metas.length - 1] || {}
          return {
            user_id: meta.user_id || key,
            name: meta.name || '',
            replying: !!meta.replying,
          }
        })
        setPresentUsers(flat)
      } catch {
        /* ignore */
      }
    }

    try {
      channel
        .on('presence', { event: 'sync' }, recompute)
        .on('presence', { event: 'join' }, recompute)
        .on('presence', { event: 'leave' }, recompute)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            presenceSubscribedRef.current = true
            try {
              channel.track({ user_id: currentUserId, name: myNameRef.current, replying: composingRef.current })
            } catch {
              /* ignore */
            }
          }
        })
    } catch {
      /* ignore */
    }

    return () => {
      presenceSubscribedRef.current = false
      try {
        channel.untrack()
      } catch {
        /* ignore */
      }
      try {
        supabase.removeChannel(channel)
      } catch {
        /* ignore */
      }
      presenceChannelRef.current = null
      setPresentUsers([])
    }
  }, [threadId, currentUserId])

  // Re-broadcast our presence when the reply composer opens/closes (replying)
  // or once our display name resolves.
  useEffect(() => {
    const channel = presenceChannelRef.current
    if (!channel || !presenceSubscribedRef.current) return
    try {
      channel.track({ user_id: currentUserId, name: myNameRef.current, replying: composerMode !== null })
    } catch {
      /* ignore */
    }
  }, [composerMode, myName, currentUserId])

  function toggleMention(id: string) {
    setMentionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

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
        // Phase 3B — mentioned_user_ids: the backend DMs these teammates. Purely
        // additive; the note text itself is saved exactly as before.
        body: JSON.stringify({ body, mentioned_user_ids: mentionIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.note) {
        setDetail((prev) => (prev ? { ...prev, notes: [...prev.notes, data.note] } : prev))
        setNoteText('')
        setMentionIds([])
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

  const { thread, messages, members, notes, permissions, customer } = detail
  const isClosed = thread.status === 'closed'
  const subject = thread.subject || '(no subject)'

  const allExpanded = messages.length > 0 && messages.every((m) => expanded.has(m.id))
  function toggleExpandAll() {
    const last = messages[messages.length - 1]
    setExpanded(allExpanded ? new Set(last ? [last.id] : []) : new Set(messages.map((m) => m.id)))
  }

  // One time-ordered conversation: emails and internal notes interleaved, with a
  // divider wherever the day changes. Notes come back only to people allowed to
  // read them (RLS), so an empty list simply shows none.
  type TimelineItem =
    | { kind: 'message'; at: number; message: EmailMessage }
    | { kind: 'note'; at: number; note: ThreadNote }
  const stamp = (iso: string | null | undefined) => {
    const t = iso ? new Date(iso).getTime() : NaN
    return Number.isNaN(t) ? 0 : t
  }
  const timeline: TimelineItem[] = [
    ...messages.map((m) => ({ kind: 'message' as const, at: stamp(m.message_date), message: m })),
    ...notes.map((n) => ({ kind: 'note' as const, at: stamp(n.created_at), note: n })),
  ].sort((a, b) => a.at - b.at)
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

  // Phase 3B — collision detection: everyone present on this thread except me,
  // split into those actively replying vs just reading.
  const presenceOthers = presentUsers.filter((p) => p.user_id !== currentUserId)
  const replyingOthers = presenceOthers.filter((p) => p.replying)
  const viewingOthers = presenceOthers.filter((p) => !p.replying)
  // Teammates the note author can @mention (non-bot, excluding self).
  const mentionCandidates = hubUsers.filter((u) => u.id !== currentUserId)

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
              {messages.length > 1 ? ` · ${messages.length} messages` : ''}
            </div>
            {/* Customer file — the same jump the Txt thread offers, so a reply
                can be written with the account's history in reach. Rendered only
                when the counterpart resolves to a directory contact, which is a
                minority of shared-mailbox traffic (vendors, newsletters and
                internal mail have no customer to point at). */}
            {customer && (
              <Link
                href={`/hub/contacts/${customer.contactId}`}
                className="inline-flex items-center gap-1 mt-1 text-xs text-indigo-700 hover:text-indigo-900 hover:underline"
                title={`Open the customer file for ${customer.name?.trim() || customer.email || 'this contact'}`}
              >
                👤 Customer file
                {customer.name?.trim() ? (
                  <span className="text-gray-500 font-normal truncate max-w-[180px]">
                    · {customer.name.trim()}
                  </span>
                ) : null}
              </Link>
            )}
          </div>
          {statusChip}
        </div>

        {/* Phase 3B — collision detection: who else is here / replying right now */}
        {presenceOthers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {replyingOthers.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-800 font-medium">
                ✍️ {replyingOthers.map((p) => firstName(p.name) || 'Someone').join(', ')}{' '}
                {replyingOthers.length === 1 ? 'is' : 'are'} replying…
              </span>
            )}
            {viewingOthers.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-700">
                👁 {viewingOthers.map((p) => firstName(p.name) || 'Someone').join(', ')} also viewing
              </span>
            )}
          </div>
        )}

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

        {/* Action bar — thread handling. Reply / Reply all / Forward live at the
            foot of the conversation (and on each open message), Gmail-style. */}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
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
                🏷 Tags ▾
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
          {messages.length > 1 && (
            <button
              type="button"
              onClick={toggleExpandAll}
              className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 ml-auto"
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
      </div>

      {/* Body: one conversation, oldest at the top — earlier emails fold to a single
          line, the newest is open, and notes sit where they were written. */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 min-h-0">
        <div className="max-w-4xl mx-auto w-full">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-8">No messages yet.</div>
          )}
          {timeline.map((item, i) => {
            const prevAt = i > 0 ? timeline[i - 1].at : null
            const day = item.at ? dayLabel(new Date(item.at).toISOString()) : ''
            const prevDay = prevAt ? dayLabel(new Date(prevAt).toISOString()) : ''
            const showDay = !!day && day !== prevDay
            return (
              <div key={item.kind === 'message' ? item.message.id : `note-${item.note.id}`}>
                {showDay && (
                  <div
                    className={`flex items-center gap-3 mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 ${
                      i === 0 ? '' : 'mt-4'
                    }`}
                  >
                    <div className="flex-1 h-px bg-gray-300" />
                    <span>{day}</span>
                    <div className="flex-1 h-px bg-gray-300" />
                  </div>
                )}
                {item.kind === 'message' ? (
                  <MessageCard
                    message={item.message}
                    expanded={expanded.has(item.message.id)}
                    onToggle={() => toggleExpanded(item.message.id)}
                    onReply={permissions.canReply && !isClosed ? () => setComposerMode('reply') : undefined}
                  />
                ) : (
                  <NoteItem note={item.note} />
                )}
              </div>
            )
          })}

          {/* Reply bar — Gmail-style, at the foot of the conversation. */}
          {(permissions.canReply || permissions.canNote) && (
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {resumeDraftMode && !isClosed && (
                <button
                  type="button"
                  onClick={() => setComposerMode(resumeDraftMode)}
                  className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full bg-amber-500 hover:bg-amber-400 text-[#fff] text-sm font-medium"
                  title="You have an unsent reply saved on this conversation"
                >
                  ✎ Resume draft
                </button>
              )}
              {permissions.canReply && !isClosed && (
                <ReplyPill label="Reply" icon="reply" onClick={() => setComposerMode('reply')} />
              )}
              {permissions.canReply && !isClosed && (
                <ReplyPill label="Reply all" icon="reply-all" onClick={() => setComposerMode('reply-all')} />
              )}
              {permissions.canReply && (
                <ReplyPill label="Forward" icon="forward" onClick={() => setComposerMode('forward')} />
              )}
              {permissions.canNote && (
                <button
                  type="button"
                  onClick={() => setShowNotes((v) => !v)}
                  className={`inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full border text-sm ${
                    showNotes
                      ? 'bg-amber-100 border-amber-300 text-amber-900'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Add internal note
                </button>
              )}
            </div>
          )}
          {permissions.canReply && permissions.canClaim && !thread.assigned_to_user_id && (
            <p className="mt-2 text-xs text-gray-500">Replying claims this conversation for you, so it leaves the Queue.</p>
          )}

          {showNotes && permissions.canNote && (
            <div className="mt-3" ref={noteComposerRef}>
              <NoteComposer
                noteText={noteText}
                setNoteText={setNoteText}
                onSave={saveNote}
                saving={savingNote}
                mentionCandidates={mentionCandidates}
                mentionIds={mentionIds}
                onToggleMention={toggleMention}
              />
            </div>
          )}
        </div>
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

// Avatar colors are inline hex, not Tailwind classes: the Hub themes remap the
// Tailwind palette, and these two must read the same on every theme.
const TEAM_AVATAR = '#1f7a55'
const CUSTOMER_AVATAR = '#2f5fb3'

function recipientNames(list: EmailMessage['to_recipients'] | null | undefined): string {
  return (list || [])
    .map((r) => (r.name || '').trim() || r.email)
    .filter(Boolean)
    .join(', ')
}

function recipientFull(list: EmailMessage['to_recipients'] | null | undefined): string {
  return (list || [])
    .map((r) => ((r.name || '').trim() ? `${r.name!.trim()} <${r.email}>` : r.email))
    .filter(Boolean)
    .join(', ')
}

/**
 * One email in the conversation, Gmail-style. Closed: a single line (who, the
 * first words, when). Open: sender + "to …" (tap for the full From/To/Cc/Date),
 * the body with any quoted earlier messages tucked behind •••, and attachments.
 */
function MessageCard({
  message,
  expanded,
  onToggle,
  onReply,
}: {
  message: EmailMessage
  expanded: boolean
  onToggle: () => void
  onReply?: () => void
}) {
  const [showQuoted, setShowQuoted] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const isOutbound = message.direction === 'outbound'
  const who = isOutbound
    ? message.sent_by_name || message.from_name || 'Our team'
    : participantName(message.from_name, message.from_email)
  const toNames = recipientNames(message.to_recipients)
  const ccNames = recipientNames(message.cc_recipients)
  const toLine = [toNames && `to ${toNames}`, ccNames && `cc ${ccNames}`].filter(Boolean).join(', ')

  // Prepared only once the message is open (DOM parse of the body).
  const prepared = useMemo(
    () => (expanded && message.body_html ? prepareEmailHtml(message.body_html, message.id, message.attachments) : null),
    [expanded, message.body_html, message.id, message.attachments]
  )
  const embedded = new Set(prepared?.embeddedAttachmentIds || [])
  const chips = (message.attachments || []).filter((a) => !embedded.has(a.id))
  const hasFileAttachment = (message.attachments || []).some((a) => !a.isInline)

  const avatar = (size: number) => (
    <span
      aria-hidden
      className="flex-none rounded-full flex items-center justify-center font-semibold text-[#fff]"
      style={{
        width: size,
        height: size,
        fontSize: size >= 40 ? 14 : 12,
        background: isOutbound ? TEAM_AVATAR : CUSTOMER_AVATAR,
      }}
    >
      {initials(who)}
    </span>
  )

  if (!expanded) {
    return (
      <div className="mb-2 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          className="w-full text-left flex items-center gap-3 px-4 py-2.5 min-h-[52px] hover:bg-gray-50 cursor-pointer"
        >
          {avatar(32)}
          <span className="flex-none w-36 sm:w-44 truncate text-sm font-semibold text-gray-900">{who}</span>
          <span className="flex-1 min-w-0 truncate text-sm text-gray-500">{message.snippet || ''}</span>
          {hasFileAttachment && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-gray-400" role="img" aria-label="Has attachment">
              <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
            </svg>
          )}
          <span className="flex-none text-xs text-gray-500 whitespace-nowrap">{messageTime(message.message_date)}</span>
        </button>
      </div>
    )
  }

  const ago = agoLabel(message.message_date)
  return (
    <article className="mb-2 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-4 pt-4">
        {avatar(40)}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded
              title="Fold this message"
              className="text-[15px] font-semibold text-gray-900 hover:underline cursor-pointer"
            >
              {who}
            </button>
            {message.from_email && (
              <span className="text-xs text-gray-500 truncate">&lt;{message.from_email}&gt;</span>
            )}
            {isOutbound && (
              <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                TEAM
              </span>
            )}
          </div>
          {toLine && (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              className="mt-0.5 inline-flex items-center gap-1 max-w-full text-xs text-gray-500 hover:text-gray-800"
            >
              <span className="truncate">{toLine}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`flex-none transition-transform ${showDetails ? 'rotate-180' : ''}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
          {showDetails && (
            <dl className="mt-2 max-w-lg grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-gray-200 px-3 py-2 text-xs">
              <dt className="text-gray-500">From</dt>
              <dd className="text-gray-900 break-words">
                {message.from_name ? `${message.from_name} <${message.from_email || ''}>` : message.from_email}
              </dd>
              <dt className="text-gray-500">To</dt>
              <dd className="text-gray-900 break-words">{recipientFull(message.to_recipients) || '—'}</dd>
              {ccNames && (
                <>
                  <dt className="text-gray-500">Cc</dt>
                  <dd className="text-gray-900 break-words">{recipientFull(message.cc_recipients)}</dd>
                </>
              )}
              <dt className="text-gray-500">Date</dt>
              <dd className="text-gray-900">{fullMessageTime(message.message_date)}</dd>
              {isOutbound && message.sent_by_name && (
                <>
                  <dt className="text-gray-500">Sent by</dt>
                  <dd className="text-gray-900">{message.sent_by_name}, from Hub</dd>
                </>
              )}
            </dl>
          )}
        </div>
        <div className="flex-none flex items-center gap-1">
          <span className="hidden sm:inline text-xs text-gray-500 whitespace-nowrap">
            {fullMessageTime(message.message_date)}
            {ago ? ` (${ago})` : ''}
          </span>
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label="Reply"
              title="Reply"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-100"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 14L4 9l5-5" />
                <path d="M4 9h11a5 5 0 0 1 5 5v6" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="sm:hidden px-4 pt-1 text-xs text-gray-500">
        {fullMessageTime(message.message_date)}
        {ago ? ` (${ago})` : ''}
      </div>

      <div className="px-4 sm:pl-[68px] pr-4 pt-3 pb-4">
        {prepared ? (
          // Untrusted external HTML — locked-down sandbox (scripts blocked). Auto-sizes
          // to content so there's no empty box / no box-in-a-box scroll. See EmailBodyFrame.
          <EmailBodyFrame html={showQuoted || !prepared.trimmed ? prepared.full : prepared.trimmed} />
        ) : (
          <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
            {message.body_text || message.snippet || '(no content)'}
          </div>
        )}

        {prepared?.trimmed && (
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            aria-expanded={showQuoted}
            aria-label={showQuoted ? 'Hide the earlier messages quoted in this email' : 'Show the earlier messages quoted in this email'}
            title={showQuoted ? 'Hide trimmed content' : 'Show trimmed content'}
            className="mt-2 h-6 px-2.5 rounded-md border border-gray-300 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm leading-none tracking-widest"
          >
            •••
          </button>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {chips.map((raw) => {
              const a = attachmentMeta(raw)
              // A just-sent outbound attachment can still be keyed by its R2 staging
              // key (contains slashes) until the next sync re-mirrors it with the
              // provider id — that isn't downloadable via the [messageId]/[attachmentId]
              // route, so show a non-clickable chip instead of a link that 404s.
              const downloadable = !!a.id && !a.id.includes('/')
              const inner = (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none text-gray-500">
                    <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                  </svg>
                  <span className="max-w-[200px] truncate font-medium">{a.filename}</span>
                  <span className="text-gray-500">{fileSize(a.size)}</span>
                </>
              )
              return downloadable ? (
                <a
                  key={a.id}
                  href={`/api/hub/email/attachments/${message.id}/${encodeURIComponent(a.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-800 hover:bg-gray-50 hover:border-gray-300"
                  title={`${a.filename}${a.contentType ? ` · ${a.contentType}` : ''}`}
                >
                  {inner}
                </a>
              ) : (
                <span
                  key={a.id || a.filename}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-400"
                  title="Available once this message finishes syncing"
                >
                  {inner}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </article>
  )
}

/** An internal note, in the conversation where it was written. */
function NoteItem({ note }: { note: ThreadNote }) {
  return (
    <div className="mb-2 flex items-start gap-2.5 rounded-xl border border-dashed border-amber-400 bg-amber-50 px-4 py-2.5">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none mt-0.5 text-amber-800">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <div className="min-w-0">
        <div className="text-xs text-amber-900">
          <strong>{note.created_by_name || 'Someone'}</strong> left an internal note · {messageTime(note.created_at)} ·{' '}
          <em>the customer never sees this</em>
        </div>
        <div className="mt-0.5 text-sm text-gray-900 whitespace-pre-wrap break-words">{note.body}</div>
      </div>
    </div>
  )
}

/** Reply / Reply all / Forward pill at the foot of the conversation. */
function ReplyPill({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: 'reply' | 'reply-all' | 'forward'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-800"
    >
      <svg width={icon === 'reply-all' ? 18 : 16} height="16" viewBox={icon === 'reply-all' ? '0 0 28 24' : '0 0 24 24'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {icon === 'reply' && (
          <>
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h11a5 5 0 0 1 5 5v6" />
          </>
        )}
        {icon === 'reply-all' && (
          <>
            <path d="M13 14L8 9l5-5" />
            <path d="M8 14L3 9l5-5" />
            <path d="M8 9h11a5 5 0 0 1 5 5v6" />
          </>
        )}
        {icon === 'forward' && (
          <>
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9a5 5 0 0 0-5 5v6" />
          </>
        )}
      </svg>
      {label}
    </button>
  )
}

/** The internal-note composer (staff only), opened from "Add internal note". */
function NoteComposer({
  noteText,
  setNoteText,
  onSave,
  saving,
  mentionCandidates,
  mentionIds,
  onToggleMention,
}: {
  noteText: string
  setNoteText: (v: string) => void
  onSave: () => void
  saving: boolean
  mentionCandidates: { id: string; display_name: string }[]
  mentionIds: string[]
  onToggleMention: (id: string) => void
}) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="text-xs text-amber-900">Internal note — only your team sees this, never the customer.</div>
      {/* Phase 3B — @mention teammates to notify when this note posts. */}
      <MentionField candidates={mentionCandidates} selectedIds={mentionIds} onToggle={onToggleMention} />
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="Add a note (staff only)…"
        rows={3}
        className="w-full px-3 py-2 rounded-lg bg-white border border-amber-200 text-gray-900 placeholder-gray-400 resize-y focus:outline-none focus:border-amber-400"
        style={{ fontSize: 16 }}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={!noteText.trim() || saving}
        className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-[#fff] text-sm font-medium disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save note'}
      </button>
    </div>
  )
}

/**
 * Phase 3B — @mention teammate notify picker for an internal note. A compact
 * "＠ Notify" button opens a searchable checklist of non-bot teammates; chosen
 * teammates render as removable chips. The selected ids ride along as
 * `mentioned_user_ids` when the note posts so the backend can DM them. Mirrors
 * the TagMenu dropdown pattern (outside-click close); opens UPWARD since the
 * notes composer sits at the bottom of its pane.
 */
function MentionField({
  candidates,
  selectedIds,
  onToggle,
}: {
  candidates: { id: string; display_name: string }[]
  selectedIds: string[]
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const selected = new Set(selectedIds)
  const q = query.trim().toLowerCase()
  const filtered = candidates.filter((u) => !q || u.display_name.toLowerCase().includes(q))
  const chosen = candidates.filter((u) => selected.has(u.id))

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] px-2 py-0.5 rounded-md bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
          title="Notify a teammate about this note"
        >
          ＠ Notify
        </button>
        {open && (
          <div className="absolute left-0 bottom-full mb-1 w-52 bg-white border border-gray-200 rounded-md shadow-xl z-50 py-1">
            <div className="px-2 pb-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search teammates…"
                className="w-full px-2 py-1 rounded-md border border-gray-300 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400"
                style={{ fontSize: 16 }}
              />
            </div>
            <div className="max-h-52 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">No teammates</div>
              ) : (
                filtered.map((u) => {
                  const isSel = selected.has(u.id)
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => onToggle(u.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span className="w-3.5 flex-none text-emerald-600">{isSel ? '✓' : ''}</span>
                      <span className="truncate">{u.display_name}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
      {chosen.map((u) => (
        <span
          key={u.id}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-700"
        >
          ＠{firstName(u.display_name) || u.display_name}
          <button
            type="button"
            onClick={() => onToggle(u.id)}
            className="text-sky-400 hover:text-sky-700 leading-none"
            aria-label={`Remove ${u.display_name}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
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
