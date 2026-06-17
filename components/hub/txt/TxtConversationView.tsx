'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ContactModal, { type ContactForModal } from './ContactModal'
import TemplatePicker, { filterTemplates, type PickerTemplate } from './TemplatePicker'
import EmojiPicker from '@/components/hub/EmojiPicker'
import { createClient } from '@/lib/supabase/client'
import { renderTemplate, DEFAULT_ON_MY_WAY_TEMPLATE } from '@/lib/txt-templates'
import { CallMarker, VoicemailMarker, type TimelineCallEvent } from './TimelineMarkers'

type Message = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  media_urls: string[]
  status: string
  error_message: string | null
  twilio_sid: string | null
  created_at: string
  sent_by: string | null
  sender?: { id: string; display_name: string } | null
}

type Note = {
  id: string
  body: string
  created_at: string
  created_by: string
  author?: { id: string; display_name: string } | null
}

type Contact = {
  id: string
  name: string
  phone: string
  email: string | null
  do_not_text: boolean
  jobber_client_id: string | null
}

type Conversation = {
  id: string
  kind?: 'direct' | 'group'
  status: 'unassigned' | 'assigned' | 'archived'
  assigned_to: string | null
  last_message_at: string | null
  contact: Contact | null
  assignee: { id: string; display_name: string } | null
  phone_number_id?: string | null
}

type PhoneNumberOption = {
  id: string
  twilio_number: string
  label: string | null
  is_default: boolean
}

type HubUser = { id: string; display_name: string }

type Member = {
  user_id: string
  role: 'owner' | 'member'
  added_at?: string
  user?: { id: string; display_name: string } | { id: string; display_name: string }[] | null
}

type GroupContactRow = {
  contact: Contact | Contact[] | null
}

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const today = new Date().toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (d.toDateString() === today) return time
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'sending':
      return <span className="text-white/40">⏱</span>
    case 'sent':
      return <span className="text-white/60">✓</span>
    case 'delivered':
      return <span className="text-emerald-300">✓✓</span>
    case 'failed':
      return <span className="text-red-400">⚠</span>
    default:
      return null
  }
}

type SuggestTone = 'professional' | 'friendly' | 'brief'
const SUGGEST_TONES: { value: SuggestTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'brief', label: 'Brief' },
]

export default function TxtConversationView({
  initialConversation,
  initialMessages,
  initialNotes,
  initialMembers = [],
  initialGroupContacts = [],
  hubUsers,
  currentUserId,
  currentUserName,
  companyName,
  companyId,
  canAssign,
  canAccessDialer,
  canAccessUnifiedInbox = false,
  hasGuardian = false,
}: {
  initialConversation: Conversation
  initialMessages: Message[]
  initialNotes: Note[]
  initialMembers?: Member[]
  initialGroupContacts?: GroupContactRow[]
  hubUsers: HubUser[]
  currentUserId: string
  currentUserName: string | null
  companyName: string | null
  companyId: string
  canAssign: boolean
  canAccessDialer: boolean
  canAccessUnifiedInbox?: boolean
  hasGuardian?: boolean
}) {
  const router = useRouter()
  const [conversation, setConversation] = useState(initialConversation)
  const [messages, setMessages] = useState(initialMessages)
  const [notes, setNotes] = useState(initialNotes)
  // Unified Inbox (Session 2) — call + voicemail markers, additive on top of the
  // existing texts (messages) + notes timeline. Only the 'call'/'voicemail' kinds
  // are kept from /api/txt/timeline; texts/notes already come from their own
  // state above, so this never double-renders them. Flag off => never fetched.
  const [callEvents, setCallEvents] = useState<TimelineCallEvent[]>([])
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const groupContacts = initialGroupContacts
    .map((row) => unwrap(row.contact))
    .filter((c): c is Contact => Boolean(c))
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  // Expand/collapse the composer (toolbar toggle, mirrors the Hub composer).
  const [expanded, setExpanded] = useState(false)
  // Emoji picker (😀 toolbar button) — same picker the Hub composer uses.
  const [emojiOpen, setEmojiOpen] = useState(false)
  // On-My-Way (🚗) — admin-editable template + ETA picker. Picking an ETA
  // renders the template into the composer for the tech to review + send.
  const [omwOpen, setOmwOpen] = useState(false)
  const [omwTemplate, setOmwTemplate] = useState<string | null>(null)
  const [omwCustom, setOmwCustom] = useState('')
  // Scheduled send (⏰) — queue an SMS for later; a cron delivers it.
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [scheduledList, setScheduledList] = useState<
    Array<{ id: string; body: string | null; send_at: string }>
  >([])
  const [showNotes, setShowNotes] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [editContactOpen, setEditContactOpen] = useState(false)
  const [numbers, setNumbers] = useState<PhoneNumberOption[]>([])
  const [numberPickerOpen, setNumberPickerOpen] = useState(false)
  // Pending MMS attachments — staged client-side via the 📎 button, sent in
  // media_urls on next sendMessage(). Each item is the storage_path returned
  // by /api/txt/upload (Twilio fetches via /api/txt/media/[...key]).
  const [pendingAttachments, setPendingAttachments] = useState<
    { storage_path: string; filename: string; preview: string }[]
  >([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Hold the message list hidden until it's pinned to the bottom, so opening a
  // conversation never shows a scroll jump (mirrors the Hub MessageFeed).
  const [feedReady, setFeedReady] = useState(false)
  // Load-older pagination (#33 part 2): true when the server indicated there
  // are messages before the earliest one currently loaded.
  const [hasMoreOlder, setHasMoreOlder] = useState(initialMessages.length >= 500)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Refs used to restore scroll position after prepending older messages so the
  // view doesn't jump. prependingRef tells the snap-to-bottom useEffect to skip.
  const prependingRef = useRef(false)
  const prevScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)

  const isGroup = conversation.kind === 'group'
  const ownerId = conversation.assigned_to
  const memberRows = members.filter((m) => m.role === 'member')
  const isOwnerMe = ownerId === currentUserId
  const isMemberMe = members.some((m) => m.user_id === currentUserId)
  const canManageMembers = isOwnerMe || canAssign

  const memberCandidates = hubUsers.filter(
    (u) => u.id !== currentUserId && !members.some((m) => m.user_id === u.id)
  )

  // Templates: loaded once on mount. The picker opens on `/` trigger (parsed
  // from the textarea content) or via the dedicated 📋 toolbar button.
  // selectedTemplateId is tracked from pick → send so the server-side renderer
  // knows this was a template-driven send and runs {field} substitution.
  const [templates, setTemplates] = useState<PickerTemplate[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerIndex, setPickerIndex] = useState(0)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  // Suggest Reply (Guardian) — Session 3. Dual-gated by canReply (server-side)
  // and hasGuardian (prop from page). Header button opens a tone popover;
  // picking a tone fires /suggest-reply and inserts the response in the
  // composer, prompting before clobbering an existing draft.
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)

  // "Polish draft" (✨) — Unified Inbox Session 5. Refines the user's OWN draft
  // (grammar/tone/clarity) via /refine-draft without replacing their intent.
  // polishUndo holds the pre-polish text so the user can revert with one click.
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishUndo, setPolishUndo] = useState<string | null>(null)

  // "Catch me up" — Unified Inbox Session 5. A 2–3 sentence relationship roll-up
  // built from stored call/voicemail summaries + recent texts. Read-only; gated
  // on can_access_unified_inbox (the prop), shown in the header.
  const [catchOpen, setCatchOpen] = useState(false)
  const [catchLoading, setCatchLoading] = useState(false)
  const [catchSummary, setCatchSummary] = useState<string | null>(null)
  const [catchError, setCatchError] = useState<string | null>(null)
  // SENDING is restricted to the owner or an added member — NOT every Txt2
  // user. A non-participant reads the thread but must Claim (Queue) or Join
  // (someone else's thread) first to get a composer. (Managers join too — being
  // a manager no longer grants a silent voice in someone else's thread.)
  const canReplyHere = isOwnerMe || isMemberMe
  // An unassigned (Queue) thread has no owner yet — it's claimable.
  const isUnassigned = conversation.status === 'unassigned'
  // The composer (and its toolbar) renders ONLY when the user can actually
  // send: they're the owner or an added member. Claiming/joining are explicit
  // header/footer actions that reveal the composer after they succeed.
  const canComposeHere = canReplyHere
  // Archiving for everyone is owner-level — owner or a Txt manager only
  // (`canAssign` is the manager flag from the page). Mirrors the server gate.
  const canArchive = isOwnerMe || canAssign

  async function runSuggestReply(tone: SuggestTone) {
    setSuggestOpen(false)
    if (suggestLoading) return
    setSuggestLoading(true)
    setSendError('')
    try {
      const res = await fetch(
        `/api/txt/conversations/${conversation.id}/suggest-reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tone }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.suggestion) {
        setSendError(data.error || "Couldn't generate suggestion — try again")
        return
      }
      const suggestion: string = data.suggestion
      const existing = text.trim()
      if (existing.length > 5) {
        const ok =
          typeof window !== 'undefined' &&
          window.confirm('Replace your current draft with the suggestion?')
        if (!ok) return
      }
      setText(suggestion)
      // Drop the template flag — suggestion replaces any in-flight template
      // pick so the server-side template renderer doesn't try to substitute
      // fields into a body that was never one of our templates.
      setSelectedTemplateId(null)
      setTimeout(() => textareaRef.current?.focus(), 0)
    } catch {
      setSendError("Couldn't generate suggestion — try again")
    } finally {
      setSuggestLoading(false)
    }
  }

  // ✨ Polish — send the user's current draft to /refine-draft and swap in the
  // cleaned version, stashing the original so they can undo. Never generates a
  // reply; it only refines what they already typed/dictated.
  async function runPolishDraft() {
    const draft = text.trim()
    if (polishLoading || !draft) return
    setPolishLoading(true)
    setSendError('')
    try {
      const res = await fetch(
        `/api/txt/conversations/${conversation.id}/refine-draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft_text: text }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.refined) {
        setSendError(data.error || "Couldn't polish the draft — try again")
        return
      }
      const refined: string = data.refined
      if (refined.trim() === draft) {
        // Already clean — nothing to undo, no churn.
        return
      }
      setPolishUndo(text)
      // A polished draft is no longer a verbatim template, so drop the flag.
      setSelectedTemplateId(null)
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

  // "Catch me up" — fetch a fresh roll-up each open (cheap; relationship state
  // changes as new texts/calls land).
  async function runCatchMeUp() {
    if (catchOpen) {
      setCatchOpen(false)
      return
    }
    setCatchOpen(true)
    setCatchLoading(true)
    setCatchError(null)
    setCatchSummary(null)
    try {
      const res = await fetch(
        `/api/txt/conversations/${conversation.id}/catch-me-up`,
        { method: 'POST' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        setCatchError(data.error || "Couldn't summarize — try again")
        return
      }
      setCatchSummary(data.summary || 'No summary available.')
    } catch {
      setCatchError("Couldn't summarize — try again")
    } finally {
      setCatchLoading(false)
    }
  }

  useEffect(() => {
    fetch('/api/txt/templates')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setTemplates(data.templates || []))
      .catch(() => setTemplates([]))
    fetch('/api/txt/numbers')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setNumbers(data.numbers || []))
      .catch(() => setNumbers([]))
    fetch('/api/txt/settings')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setOmwTemplate(data.on_my_way_template ?? null))
      .catch(() => setOmwTemplate(null))
    loadScheduled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On-My-Way: render the company template (or the default) with the contact's
  // first name, the sender, the company, and the chosen ETA, then drop it into
  // the composer for review. {eta} isn't a contact/sender field so it's filled
  // in after renderTemplate.
  function applyOnMyWay(eta: number) {
    const tmpl = (omwTemplate && omwTemplate.trim()) || DEFAULT_ON_MY_WAY_TEMPLATE
    const rendered = renderTemplate(tmpl, {
      contactName: conversation.contact?.name || null,
      senderName: currentUserName,
      companyName,
    }).replace(/\{eta\}/g, String(eta))
    setText(rendered)
    setSelectedTemplateId(null)
    setOmwOpen(false)
    setOmwCustom('')
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  async function loadScheduled() {
    const res = await fetch(`/api/txt/conversations/${conversation.id}/schedule`)
    if (res.ok) {
      const data = await res.json()
      setScheduledList(data.scheduled || [])
    }
  }

  // Queue the current composer content for later delivery.
  async function scheduleMessage() {
    if (scheduling) return
    const bodyText = text.trim()
    const media = pendingAttachments.map((a) => a.storage_path)
    if (!bodyText && media.length === 0) {
      setSendError('Type a message (or attach something) to schedule')
      return
    }
    if (!scheduleAt) {
      setSendError('Pick a date & time')
      return
    }
    const when = new Date(scheduleAt)
    if (isNaN(when.getTime()) || when <= new Date()) {
      setSendError('Pick a time in the future')
      return
    }
    setScheduling(true)
    setSendError('')
    const res = await fetch(`/api/txt/conversations/${conversation.id}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: bodyText,
        media_urls: media,
        template_id: selectedTemplateId,
        send_at: when.toISOString(),
      }),
    })
    const data = await res.json().catch(() => ({}))
    setScheduling(false)
    if (!res.ok) {
      setSendError(data.error || 'Could not schedule')
      return
    }
    // Clear the composer + staged attachments, mirroring a send.
    pendingAttachments.forEach((a) => URL.revokeObjectURL(a.preview))
    setPendingAttachments([])
    setText('')
    setSelectedTemplateId(null)
    setScheduleAt('')
    setScheduleOpen(false)
    loadScheduled()
  }

  async function cancelScheduled(scheduledId: string) {
    const res = await fetch(
      `/api/txt/conversations/${conversation.id}/schedule?scheduled_id=${encodeURIComponent(scheduledId)}`,
      { method: 'DELETE' }
    )
    if (res.ok) {
      setScheduledList((prev) => prev.filter((s) => s.id !== scheduledId))
    }
  }

  // Open the conversation already pinned to the latest message — no animated
  // scroll, no landing mid-thread. Same approach the Hub MessageFeed uses:
  // pin to the bottom behind a visibility shield while late-loading images
  // settle (ResizeObserver + staggered re-pins), then reveal.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    let pinning = true
    const pin = () => { if (pinning) el.scrollTop = el.scrollHeight }
    pin()

    let revealed = false
    const reveal = () => {
      if (revealed) return
      revealed = true
      pin() // one last pin right before the user sees anything
      setFeedReady(true)
    }

    const imgs = Array.from(el.querySelectorAll('img'))
    let pending = imgs.filter((img) => !(img.complete && img.naturalHeight !== 0)).length
    if (pending === 0) reveal()
    const onImgSettled = () => {
      pin()
      pending -= 1
      if (pending <= 0) reveal()
    }
    imgs.forEach((img) => {
      if (img.complete && img.naturalHeight !== 0) return
      img.addEventListener('load', onImgSettled, { once: true })
      img.addEventListener('error', onImgSettled, { once: true })
    })

    const revealCap = setTimeout(reveal, 1500)
    const timers = [0, 50, 150, 400, 900].map((ms) => setTimeout(pin, ms))
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(pin) : null
    ro?.observe(el)
    const stopAt = setTimeout(() => { pinning = false; ro?.disconnect() }, 2000)
    return () => {
      pinning = false
      clearTimeout(revealCap)
      timers.forEach(clearTimeout)
      clearTimeout(stopAt)
      ro?.disconnect()
      imgs.forEach((img) => {
        img.removeEventListener('load', onImgSettled)
        img.removeEventListener('error', onImgSettled)
      })
    }
    // Mount-only — the conversation view remounts per conversation (the poll
    // effect is keyed on conversation.id), so this re-pins on every open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After prepending older messages: restore scroll so the view doesn't jump.
  // useLayoutEffect fires before paint, so the user never sees the jump.
  useLayoutEffect(() => {
    if (!prependingRef.current) return
    const el = scrollContainerRef.current
    const prev = prevScrollRef.current
    if (!el || !prev) return
    el.scrollTop = prev.scrollTop + (el.scrollHeight - prev.scrollHeight)
    prevScrollRef.current = null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // Snap to the bottom on a new message (own send or incoming poll). Instant,
  // not smooth — matches "just opens to the bottom". Skip when a prepend just
  // happened (prependingRef stays true until this effect clears it).
  useEffect(() => {
    if (prependingRef.current) {
      prependingRef.current = false
      return
    }
    const el = scrollContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, callEvents.length, conversation.id])

  async function loadOlderMessages() {
    if (loadingOlder || !hasMoreOlder) return
    const oldest = messages[0]
    if (!oldest) return
    setLoadingOlder(true)
    const el = scrollContainerRef.current
    if (el) {
      prevScrollRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
    }
    prependingRef.current = true
    try {
      const res = await fetch(
        `/api/txt/conversations/${conversation.id}?messages_only=1&before=${encodeURIComponent(oldest.created_at)}`
      )
      if (!res.ok) {
        prependingRef.current = false
        prevScrollRef.current = null
        return
      }
      const data = await res.json()
      const older: Message[] = data.messages || []
      setHasMoreOlder(data.has_more_older ?? older.length >= 100)
      if (older.length > 0) {
        setMessages((prev) => [...older, ...prev])
        // prependingRef is cleared by the snap-to-bottom useEffect above
      } else {
        prependingRef.current = false
        prevScrollRef.current = null
      }
    } catch {
      prependingRef.current = false
      prevScrollRef.current = null
    } finally {
      setLoadingOlder(false)
    }
  }

  // #27 — realtime. Instead of re-fetching the whole thread every 8s (which
  // churned the message list and felt laggy), we refetch only when something
  // actually changes. The inbound webhook + delivery-status route already
  // broadcast on the company-wide `txt:{companyId}` channel with the affected
  // conversation_id, so we subscribe to that and refresh on a matching event.
  // A slow 30s fallback poll reconciles if a broadcast is ever dropped (Supabase
  // broadcasts aren't persisted), so the thread can never silently go stale.
  useEffect(() => {
    let cancelled = false
    const convId = conversation.id

    async function refresh() {
      const res = await fetch(`/api/txt/conversations/${convId}`)
      if (!res.ok || cancelled) return
      const data = await res.json()
      setConversation(data.conversation)
      setMessages(data.messages || [])
      setNotes(data.notes || [])
      setMembers(data.members || [])
    }

    const supabase = createClient()
    const channel = supabase
      .channel(`txt:${companyId}`)
      .on('broadcast', { event: 'inbound' }, ({ payload }) => {
        if ((payload as { conversation_id?: string })?.conversation_id === convId) refresh()
      })
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        if ((payload as { conversation_id?: string })?.conversation_id === convId) refresh()
      })
      .subscribe()

    // Safety-net reconcile (much slower than the old 8s churn).
    const t = setInterval(refresh, 30000)

    return () => {
      cancelled = true
      clearInterval(t)
      supabase.removeChannel(channel)
    }
  }, [conversation.id, companyId])

  // Unified Inbox (Session 2 + 5) — pull the contact's call + voicemail events
  // and interleave them into the thread. Read-only, behind can_access_unified_inbox.
  // Per-contact (not per-conversation): group threads have no single contact and
  // are text-only in v1 (PRD §7.3).
  //
  // Session 5 realtime: in addition to the on-load fetch, subscribe to the
  // call transcription pipeline's `call-updated` broadcast on
  // `call-log2:{companyId}` (lib/call-transcribe.ts) so a new/finished call —
  // and the voicemail folded into it — appears live without a reload. Texts
  // already refresh via the `txt:{companyId}` channel above; orphan voicemails
  // catch up on the 30s reconcile. The per-contact timeline query is tiny, so a
  // broadcast for any call in the company just re-fetches this contact cheaply.
  useEffect(() => {
    const contactId = conversation.contact?.id
    if (!canAccessUnifiedInbox || isGroup || !contactId) {
      setCallEvents([])
      return
    }
    let cancelled = false

    async function loadCallEvents() {
      try {
        const res = await fetch(`/api/txt/timeline?contact_id=${encodeURIComponent(contactId!)}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const events: TimelineCallEvent[] = (data.events || []).filter(
          (e: { kind?: string }) => e.kind === 'call' || e.kind === 'voicemail'
        )
        if (!cancelled) setCallEvents(events)
      } catch {
        /* non-fatal — the thread still renders texts + notes */
      }
    }

    loadCallEvents()

    const supabase = createClient()
    const channel = supabase
      .channel(`call-log2:${companyId}`)
      .on('broadcast', { event: 'call-updated' }, () => loadCallEvents())
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [canAccessUnifiedInbox, isGroup, conversation.contact?.id, companyId])

  async function addMember(userId: string) {
    setAddMemberOpen(false)
    const res = await fetch(`/api/txt/conversations/${conversation.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (res.ok) {
      const u = hubUsers.find((x) => x.id === userId)
      if (u) {
        setMembers((prev) => [
          ...prev,
          { user_id: userId, role: 'member', user: { id: u.id, display_name: u.display_name } },
        ])
      }
    }
  }

  // Self-join — any Txt2 user can add themselves so they get a voice in the
  // thread (then the composer appears). No need to wait to be added.
  const [joining, setJoining] = useState(false)
  async function joinConversation() {
    if (joining) return
    setJoining(true)
    try {
      const res = await fetch(`/api/txt/conversations/${conversation.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUserId }),
      })
      if (res.ok) {
        setMembers((prev) =>
          prev.some((m) => m.user_id === currentUserId)
            ? prev
            : [
                ...prev,
                {
                  user_id: currentUserId,
                  role: 'member',
                  user: { id: currentUserId, display_name: currentUserName || 'You' },
                },
              ]
        )
      }
    } finally {
      setJoining(false)
    }
  }

  async function removeMember(userId: string) {
    const res = await fetch(
      `/api/txt/conversations/${conversation.id}/members?user_id=${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    )
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => !(m.user_id === userId && m.role === 'member')))
    }
  }

  async function sendMessage() {
    const body = text.trim()
    const attachmentsSnapshot = pendingAttachments
    // Allow attachment-only sends (body can be empty if there's at least one media).
    if ((!body && attachmentsSnapshot.length === 0) || sending) return
    setSending(true)
    setSendError('')
    closePicker()

    const tempId = `temp-${Date.now()}`
    // Optimistic body is whatever the user sees — the server will render
    // {first_name} etc. on its end, so the optimistic bubble may briefly show
    // raw tokens. The poll fetch (8s) reconciles to the rendered body.
    const optimistic: Message = {
      id: tempId,
      direction: 'outbound',
      body,
      media_urls: attachmentsSnapshot.map((a) => a.storage_path),
      status: 'sending',
      error_message: null,
      twilio_sid: null,
      created_at: new Date().toISOString(),
      sent_by: currentUserId,
      sender: currentUserName ? { id: currentUserId, display_name: currentUserName } : null,
    }
    setMessages((prev) => [...prev, optimistic])
    const templateIdForSend = selectedTemplateId
    setText('')
    setSelectedTemplateId(null)
    setPendingAttachments([])
    // Free blob URLs now that they've left the composer; the bubble renders
    // via /api/txt/media which serves from R2.
    attachmentsSnapshot.forEach((a) => URL.revokeObjectURL(a.preview))

    const res = await fetch(`/api/txt/conversations/${conversation.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body,
        template_id: templateIdForSend,
        media_urls: attachmentsSnapshot.map((a) => a.storage_path),
      }),
    })
    const data = await res.json()
    setSending(false)

    if (!res.ok) {
      setSendError(data.error || 'Send failed')
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      return
    }

    if (!data.ok) {
      // Twilio not configured / failed — mark optimistic as failed but keep it visible
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...m, id: data.message_id || m.id, status: 'failed', error_message: data.error || 'send_failed' }
            : m
        )
      )
      setSendError(data.error === 'twilio_not_configured' ? 'Twilio not configured (staging dev mode — message persisted but not sent)' : data.error || 'Send failed')
      return
    }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === tempId
          ? { ...m, id: data.message_id, status: data.status, twilio_sid: data.twilio_sid }
          : m
      )
    )
  }

  async function assignTo(userId: string | null) {
    const res = await fetch(`/api/txt/conversations/${conversation.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_to: userId }),
    })
    if (res.ok) {
      const data = await res.json()
      const newAssignee = userId ? hubUsers.find((u) => u.id === userId) : null
      setConversation({
        ...conversation,
        assigned_to: data.conversation.assigned_to,
        status: data.conversation.status,
        assignee: newAssignee || null,
      })
    }
    setAssignOpen(false)
  }

  async function pickAttachments() {
    fileInputRef.current?.click()
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return
    setSendError('')
    setUploadingAttachment(true)
    for (const file of Array.from(files)) {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/txt/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSendError(data.error || `Upload failed for ${file.name}`)
        continue
      }
      // Local object URL for the chip preview — never persisted, freed on send.
      const preview = URL.createObjectURL(file)
      setPendingAttachments((prev) => [
        ...prev,
        { storage_path: data.storage_path, filename: data.filename, preview },
      ])
    }
    setUploadingAttachment(false)
    // Reset input so re-selecting the same file fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeAttachment(storage_path: string) {
    setPendingAttachments((prev) => {
      const target = prev.find((p) => p.storage_path === storage_path)
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter((p) => p.storage_path !== storage_path)
    })
  }

  async function setFromNumber(phoneNumberId: string | null) {
    setNumberPickerOpen(false)
    // Optimistic flip — patch will reload on next poll if it fails.
    setConversation((prev) => ({ ...prev, phone_number_id: phoneNumberId }))
    const res = await fetch(`/api/txt/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number_id: phoneNumberId }),
    })
    if (!res.ok) {
      // Revert + surface
      const data = await res.json().catch(() => ({}))
      setConversation((prev) => ({ ...prev, phone_number_id: conversation.phone_number_id }))
      setSendError(data.error || 'Failed to change from-number')
    }
  }

  function startCall() {
    const phone = conversation.contact?.phone
    if (!phone) return
    const qs = new URLSearchParams({
      number: phone,
      conversation_id: conversation.id,
    })
    if (conversation.contact?.id) qs.set('contact_id', conversation.contact.id)
    router.push(`/hub/dialer?${qs.toString()}`)
  }

  async function toggleArchive() {
    const archived = conversation.status !== 'archived'
    const res = await fetch(`/api/txt/conversations/${conversation.id}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    })
    if (res.ok) {
      const data = await res.json()
      setConversation({ ...conversation, status: data.conversation.status })
    }
  }

  function closePicker() {
    setPickerOpen(false)
    setPickerQuery('')
    setPickerIndex(0)
  }

  // The `/` trigger fires only when the entire composer body is `/` or `/<chars>`
  // (no whitespace). This matches the Slack convention and keeps mid-message
  // slashes from accidentally popping the picker.
  function detectSlashTrigger(value: string) {
    const m = value.match(/^\/([a-zA-Z0-9_-]*)$/)
    if (m) {
      setPickerOpen(true)
      setPickerQuery(m[1])
      setPickerIndex(0)
    } else if (pickerOpen) {
      closePicker()
    }
  }

  function handleTextChange(value: string) {
    setText(value)
    // A manual edit invalidates the ✨ Polish undo buffer (it no longer maps
    // back to a single pre-polish draft). Polish itself sets text via setText,
    // not this handler, so its undo buffer survives.
    if (polishUndo !== null) setPolishUndo(null)
    // If the user is editing in a way that no longer matches the picked
    // template's body, drop the template_id flag so substitution doesn't
    // run on unrelated text. We keep template_id set only when the current
    // text still contains the picked template's body (or part of it).
    if (selectedTemplateId) {
      const picked = templates.find((t) => t.id === selectedTemplateId)
      if (!picked || !value.includes(picked.body.slice(0, 20))) {
        setSelectedTemplateId(null)
      }
    }
    detectSlashTrigger(value)
  }

  function pickTemplate(t: PickerTemplate) {
    setText(t.body)
    setSelectedTemplateId(t.id)
    closePicker()
    // Defer focus to next tick so the textarea has the new value.
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function openPickerManually() {
    setPickerOpen(true)
    setPickerQuery('')
    setPickerIndex(0)
    textareaRef.current?.focus()
  }

  // Insert an emoji at the caret (or replacing the selection), then restore the
  // caret just after it. Mirrors the Hub composer's emoji insert.
  function insertEmojiAtCaret(native: string) {
    const el = textareaRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const newVal = text.slice(0, start) + native + text.slice(end)
    setText(newVal)
    const caret = start + native.length
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  async function addNote() {
    const body = noteText.trim()
    if (!body) return
    const res = await fetch(`/api/txt/conversations/${conversation.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (res.ok) {
      const data = await res.json()
      setNotes((prev) => [...prev, data.note])
      setNoteText('')
    }
  }

  const isArchived = conversation.status === 'archived'
  const phoneDisplay = conversation.contact ? formatPhone(conversation.contact.phone) : ''
  // Min for the schedule datetime-local input — 1 minute out (UX hint only;
  // the server validates send_at is in the future).
  const minScheduleDateTime = new Date(Date.now() + 60_000).toISOString().slice(0, 16)

  // Resolve a hub user id to a first name for call-marker attribution (the
  // call's initiated_by). Falls back to nothing when unknown.
  function actorFirstName(userId: string | null): string | null {
    if (!userId) return null
    const u = hubUsers.find((x) => x.id === userId)
    return u?.display_name?.trim().split(/\s+/)[0] || null
  }

  // "Guardian auto-replied" affordance → scroll to the auto-reply text. The AI
  // reply is an outbound message (sent_by null) sent at/after the voicemail's
  // ai_reply_sent_at; jump to the first such bubble.
  function jumpToGuardianReply(ts: string) {
    const target = messages.find(
      (m) => m.direction === 'outbound' && !m.sent_by && new Date(m.created_at).getTime() >= new Date(ts).getTime()
    )
    const el = target && scrollContainerRef.current?.querySelector(`[data-msg-id="${target.id}"]`)
    if (el) {
      ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-purple-400/70')
      setTimeout(() => el.classList.remove('ring-2', 'ring-purple-400/70'), 1600)
    }
  }

  // Interleave internal notes — and, behind the Unified Inbox flag, call +
  // voicemail markers — into the message stream as small centered markers, in
  // chronological order, so the thread reads as one story (texts = bubbles,
  // everything else = quiet expandable divider). Tapping a note marker opens the
  // notes panel; tapping a call/vm marker expands its audio/transcript inline.
  const timeline: Array<
    | { kind: 'message'; id: string; at: string; message: Message }
    | { kind: 'note'; id: string; at: string; note: Note }
    | { kind: 'event'; id: string; at: string; event: TimelineCallEvent }
  > = [
    ...messages.map((m) => ({ kind: 'message' as const, id: `m-${m.id}`, at: m.created_at, message: m })),
    ...notes.map((n) => ({ kind: 'note' as const, id: `n-${n.id}`, at: n.created_at, note: n })),
    ...callEvents.map((e) => ({ kind: 'event' as const, id: `${e.kind}-${e.id}`, at: e.ts, event: e })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  // Notes panel body (list + composer) — shared between the desktop right rail
  // and the mobile full-screen overlay so both stay in sync.
  const notesInner = (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {notes.length === 0 && (
          <div className="text-xs text-white/40">No notes yet.</div>
        )}
        {notes.map((n) => (
          <div key={n.id} className="bg-amber-500/10 border border-amber-500/20 rounded-md p-2">
            <div className="text-xs whitespace-pre-wrap break-words">{n.body}</div>
            <div className="text-[10px] text-white/40 mt-1">
              {n.author?.display_name?.split(' ')[0] || 'Someone'} · {formatTime(n.created_at)}
            </div>
          </div>
        ))}
      </div>
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
          onClick={addNote}
          disabled={!noteText.trim()}
          className="w-full px-2 py-1.5 rounded-md bg-amber-600/80 hover:bg-amber-600 text-xs disabled:opacity-50"
        >
          Save note
        </button>
      </div>
    </>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div
        data-hide-on-keyboard
        className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2 bg-[#0B2237]"
      >
        {isGroup ? (
          <div className="min-w-0 text-left">
            <div className="font-medium truncate flex items-center gap-1.5">
              <span>👥</span>
              <span>
                {groupContacts.length === 0
                  ? 'Group'
                  : groupContacts
                      .slice(0, 3)
                      .map((c) => c.name.split(' ')[0])
                      .join(', ') +
                    (groupContacts.length > 3 ? ` +${groupContacts.length - 3}` : '')}
              </span>
            </div>
            <div className="text-xs text-white/50 truncate">
              {groupContacts.length} participant{groupContacts.length === 1 ? '' : 's'}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => conversation.contact && setEditContactOpen(true)}
            disabled={!conversation.contact}
            className="min-w-0 text-left -ml-1 px-1 py-0.5 rounded hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent"
            title={conversation.contact ? 'Edit contact' : undefined}
          >
            <div className="font-medium truncate">
              {conversation.contact?.name || 'Unknown'}
            </div>
            <div className="text-xs text-white/50 truncate">{phoneDisplay}</div>
          </button>
        )}
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Assignment chip */}
          <div className="relative">
            <button
              onClick={() => setAssignOpen((v) => !v)}
              disabled={!canAssign && conversation.assigned_to !== currentUserId && conversation.status !== 'unassigned'}
              className={`text-xs px-2 py-1 rounded-md ${
                conversation.status === 'unassigned'
                  ? 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30'
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              } disabled:opacity-50`}
            >
              {conversation.status === 'unassigned'
                ? '+ Assign'
                : conversation.assignee
                ? `Owner: ${
                    conversation.assignee.id === currentUserId
                      ? 'You'
                      : conversation.assignee.display_name.split(' ')[0]
                  }`
                : 'Unassigned'}
            </button>
            {assignOpen && (
              <div className="absolute right-0 mt-1 w-56 bg-[#0F2E47] border border-white/10 rounded-md shadow-lg z-30 max-h-80 overflow-y-auto">
                {conversation.status === 'unassigned' && (
                  <button
                    onClick={() => assignTo(currentUserId)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                  >
                    Claim it (assign to me)
                  </button>
                )}
                {canAssign && (
                  <>
                    {hubUsers.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => assignTo(u.id)}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                      >
                        {u.display_name}
                      </button>
                    ))}
                    {conversation.assigned_to && (
                      <button
                        onClick={() => assignTo(null)}
                        className="block w-full text-left px-3 py-2 text-sm text-orange-300 hover:bg-white/5 border-t border-white/10"
                      >
                        Unassign
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {/* From-number chip (Session 54). Only shows when 2+ numbers exist so
              single-number setups stay clean. Owner / member / manager can change. */}
          {numbers.length >= 2 && canReplyHere && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setNumberPickerOpen((v) => !v)}
                className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-white/70"
                title="Change which number this conversation sends from"
              >
                {(() => {
                  const current = numbers.find((n) => n.id === conversation.phone_number_id)
                  if (current) return `From: ${current.label || formatPhone(current.twilio_number)}`
                  const def = numbers.find((n) => n.is_default)
                  return def ? `From: ${def.label || formatPhone(def.twilio_number)} (default)` : 'From: —'
                })()}
              </button>
              {numberPickerOpen && (
                <div className="absolute right-0 mt-1 w-60 bg-[#0F2E47] border border-white/10 rounded-md shadow-lg z-30 max-h-72 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => setFromNumber(null)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5 border-b border-white/10"
                  >
                    Use my default
                  </button>
                  {numbers.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setFromNumber(n.id)}
                      className={`block w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${
                        n.id === conversation.phone_number_id ? 'bg-white/5 text-emerald-300' : ''
                      }`}
                    >
                      <div className="text-sm">{n.label || formatPhone(n.twilio_number)}</div>
                      {n.label && (
                        <div className="text-[10px] text-white/40">{formatPhone(n.twilio_number)}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Member chips — separate from the owner/assignee. Owner can
              add/remove, managers can too. Members can self-remove. */}
          {memberRows.map((m) => {
            const u = unwrap(m.user)
            const label = u?.display_name?.split(' ')[0] || 'user'
            const canRemoveThis = canManageMembers || m.user_id === currentUserId
            return (
              <span
                key={m.user_id}
                className="text-[11px] px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-200 inline-flex items-center gap-1"
                title={u?.display_name || 'member'}
              >
                {label}
                {canRemoveThis && (
                  <button
                    type="button"
                    onClick={() => removeMember(m.user_id)}
                    className="text-sky-200 hover:text-white"
                    aria-label={`Remove ${label}`}
                  >
                    ×
                  </button>
                )}
              </span>
            )
          })}
          {canManageMembers && memberCandidates.length > 0 && (
            <button
              type="button"
              onClick={() => setAddMemberOpen(true)}
              className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-white/60"
              title="Add a teammate to this thread"
            >
              + member
            </button>
          )}
          {isMemberMe && !isOwnerMe && !canManageMembers && (
            <button
              type="button"
              onClick={() => removeMember(currentUserId)}
              className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-white/60"
              title="Leave this thread"
            >
              Leave
            </button>
          )}
          {/* Call button — Session 57. Direct DMs only, contact has a phone,
              user has Dialer access. Navigates to /hub/dialer with the number
              pre-filled and conversation_id + contact_id passed through so the
              resulting calls row links back to this Txt thread. User taps the
              green Call button in the Dialer themselves to actually dial. */}
          {canAccessDialer && !isGroup && conversation.contact?.phone && (
            <button
              onClick={startCall}
              className="text-xs px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              title="Call this contact in the Dialer"
              aria-label="Call"
            >
              📞
            </button>
          )}
          {/* Catch me up — Unified Inbox Session 5. Read-only AI roll-up of the
              whole relationship. Behind can_access_unified_inbox; direct threads
              only (groups are text-only in v1) and only when there's history. */}
          {canAccessUnifiedInbox && !isGroup && (messages.length > 0 || callEvents.length > 0) && (
            <button
              type="button"
              onClick={runCatchMeUp}
              disabled={catchLoading}
              className={`text-xs px-2 py-1 rounded-md inline-flex items-center gap-1 disabled:opacity-60 ${
                catchOpen
                  ? 'bg-sky-500/25 text-sky-100'
                  : 'bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
              }`}
              title="Catch me up on this customer"
              aria-label="Catch me up"
            >
              {catchLoading ? (
                <span className="inline-block w-3 h-3 border-2 border-sky-200 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span aria-hidden>🧭</span>
              )}
              <span className="hidden sm:inline">Catch me up</span>
            </button>
          )}
          {/* Suggest Reply (Guardian) — Guardian Session 3. Dual-gated:
              hasGuardian (user has any guardian_tier) AND canReply on this
              thread AND at least one message exists AND not archived AND not
              do-not-text. Click → tone popover → /suggest-reply call → insert
              into composer. */}
          {hasGuardian &&
            canReplyHere &&
            !isArchived &&
            messages.length > 0 &&
            !conversation.contact?.do_not_text && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSuggestOpen((v) => !v)}
                  disabled={suggestLoading}
                  className="text-xs px-2 py-1 rounded-md bg-violet-500/15 text-violet-200 hover:bg-violet-500/25 disabled:opacity-60 inline-flex items-center gap-1"
                  title="Suggest a reply with Guardian"
                  aria-label="Suggest reply"
                >
                  {suggestLoading ? (
                    <span className="inline-block w-3 h-3 border-2 border-violet-200 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>✨</span>
                  )}
                  <span className="hidden sm:inline">Suggest</span>
                </button>
                {suggestOpen && !suggestLoading && (
                  <div className="absolute right-0 mt-1 w-44 bg-[#0F2E47] border border-white/10 rounded-md shadow-lg z-30">
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
            )}
          <button
            onClick={() => setShowNotes((v) => !v)}
            className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 ${
              showNotes
                ? 'bg-amber-500/20 text-amber-300'
                : notes.length > 0
                ? 'bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                : 'bg-white/10 hover:bg-white/20'
            }`}
            title={notes.length > 0 ? `${notes.length} internal note${notes.length === 1 ? '' : 's'}` : 'Add internal note'}
            aria-label="Internal notes"
          >
            <span>📝</span>
            {notes.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded-full bg-amber-400/30 text-amber-100 text-[10px] font-semibold leading-none py-0.5">
                {notes.length}
              </span>
            )}
          </button>
          {canArchive && (
            <button
              onClick={toggleArchive}
              className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20"
              title={isArchived ? 'Reopen' : 'Archive'}
            >
              {isArchived ? '↺' : '✓'}
            </button>
          )}
        </div>
      </div>

      {/* Catch me up — collapsible summary panel below the header. Renders only
          while open; a fresh roll-up is fetched each time it's opened. */}
      {catchOpen && (
        <div className="px-4 py-2.5 bg-sky-500/10 border-b border-sky-500/25 text-sm flex items-start gap-2">
          <span aria-hidden className="mt-0.5">🧭</span>
          <div className="flex-1 min-w-0">
            {catchLoading ? (
              <span className="text-sky-200/70">Catching you up…</span>
            ) : catchError ? (
              <span className="text-orange-200">{catchError}</span>
            ) : (
              <span className="text-sky-50/90 whitespace-pre-wrap">{catchSummary}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCatchOpen(false)}
            className="flex-none text-sky-200/60 hover:text-sky-100 text-xs px-1"
            title="Dismiss"
            aria-label="Dismiss catch me up"
          >
            ✕
          </button>
        </div>
      )}

      {/* Opt-out banner — always visible (even when the thread is archived) so
          staff immediately see the contact is on the do-not-text list. The
          composer's own do-not-text note only renders on active threads, but a
          STOP auto-archives the thread, which would otherwise hide all signal. */}
      {conversation.contact?.do_not_text && (
        <div className="px-4 py-2 bg-orange-500/15 border-b border-orange-500/30 text-orange-200 text-sm flex items-center gap-2">
          <span aria-hidden>🚫</span>
          <span>
            This contact opted out — they&apos;re on the do-not-text list. Outbound texts are blocked.
          </span>
        </div>
      )}

      {/* Body: messages + optional notes panel */}
      <div className="flex-1 flex min-h-0">
        <div
          ref={scrollContainerRef}
          style={{ visibility: feedReady ? 'visible' : 'hidden' }}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
        >
          {hasMoreOlder && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={loadOlderMessages}
                disabled={loadingOlder}
                className="text-xs text-white/50 hover:text-white px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-50"
              >
                {loadingOlder ? 'Loading…' : '↑ Load older messages'}
              </button>
            </div>
          )}
          {timeline.length === 0 && (
            <div className="text-center text-white/40 text-sm py-8">
              No messages yet.
            </div>
          )}
          {timeline.map((item) => {
            if (item.kind === 'note') {
              const n = item.note
              return (
                <div key={item.id} className="flex justify-center my-1">
                  <button
                    type="button"
                    onClick={() => setShowNotes(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-200/90 text-[10px] hover:bg-amber-500/20 max-w-[85%]"
                    title="Internal note — tap to view"
                  >
                    <span aria-hidden>📝</span>
                    <span className="flex-none">Note · {formatTime(n.created_at)}</span>
                    {n.body && <span className="text-amber-100/60 truncate">— {n.body}</span>}
                  </button>
                </div>
              )
            }
            if (item.kind === 'event') {
              const e = item.event
              return e.kind === 'voicemail' ? (
                <VoicemailMarker key={item.id} event={e} onJumpToReply={jumpToGuardianReply} />
              ) : (
                <CallMarker
                  key={item.id}
                  event={e}
                  actorName={actorFirstName(e.actor)}
                  onJumpToReply={jumpToGuardianReply}
                />
              )
            }
            const m = item.message
            const isOutbound = m.direction === 'outbound'
            // Who sent this outbound message: the user's first name, or
            // "Guardian" when sent_by is null (responder/AI auto-sends are the
            // only outbound path without a user).
            const senderLabel = isOutbound
              ? m.sender?.display_name?.trim().split(/\s+/)[0] || (!m.sent_by ? 'Guardian' : null)
              : null
            return (
              <div
                key={item.id}
                className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  data-msg-id={m.id}
                  className={`max-w-[75%] rounded-2xl px-3 py-2 transition-shadow ${
                    isOutbound
                      ? m.status === 'failed'
                        ? 'bg-red-500/20 border border-red-500/40'
                        : 'bg-emerald-600/80'
                      : 'bg-white/10'
                  }`}
                >
                  {m.body && (
                    <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>
                  )}
                  {m.media_urls?.length > 0 && (
                    <div className={`grid gap-1 ${m.body ? 'mt-2' : ''} ${
                      m.media_urls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                    }`}>
                      {m.media_urls.map((mu, i) => {
                        // mu can be a raw storage_path (current format from
                        // /api/txt/upload + inbound webhook) or, rarely, an
                        // already-fully-qualified URL.
                        const src = /^https?:\/\//i.test(mu)
                          ? mu
                          : `/api/txt/media/${mu}`
                        // Guess image-vs-other by extension; current upload
                        // route only accepts images so this is almost always
                        // an image, but inbound MMS could in theory carry
                        // non-image types.
                        const isImage = /\.(jpe?g|png|gif|webp)$/i.test(mu) ||
                          /\.(jpe?g|png|gif|webp)(?:[?#]|$)/i.test(mu)
                        if (isImage) {
                          return (
                            <a
                              key={i}
                              href={src}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-md overflow-hidden bg-black/20"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={src}
                                alt="attachment"
                                loading="lazy"
                                className="w-full max-h-64 object-cover"
                              />
                            </a>
                          )
                        }
                        return (
                          <a
                            key={i}
                            href={src}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs underline text-white/80 hover:text-white"
                          >
                            📎 attachment {i + 1}
                          </a>
                        )
                      })}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-white/60">
                    {senderLabel && (
                      <>
                        <span className="font-medium">{senderLabel}</span>
                        <span>·</span>
                      </>
                    )}
                    <span>{formatTime(m.created_at)}</span>
                    {isOutbound && (
                      <>
                        <span>·</span>
                        <StatusIcon status={m.status} />
                      </>
                    )}
                  </div>
                  {m.error_message && isOutbound && (
                    <div className="text-[10px] text-red-300 mt-0.5">{m.error_message}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {showNotes && (
          <div className="hidden md:flex flex-col w-72 border-l border-white/10 bg-[#0B2237] min-h-0">
            <div className="px-3 py-2 border-b border-white/10 text-xs text-amber-300">
              Internal notes (not sent to customer)
            </div>
            {notesInner}
          </div>
        )}
      </div>

      {/* Composer — only when the user can actually send (owner / member, or an
          unclaimed Queue thread). Non-participants get the Join panel below. */}
      {!isArchived && canComposeHere && (
        <div className="border-t border-white/10 px-3 py-2 bg-[#0B2237]">
          {sendError && (
            <div className="text-xs text-red-300 mb-1 px-1">{sendError}</div>
          )}
          {conversation.contact?.do_not_text && (
            <div className="text-xs text-orange-300 mb-1 px-1">
              ⚠ This contact is marked do-not-text
            </div>
          )}
          {/* Pending attachment chips */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 px-1">
              {pendingAttachments.map((a) => (
                <div
                  key={a.storage_path}
                  className="relative group rounded-md overflow-hidden bg-white/5 border border-white/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.preview} alt={a.filename} className="w-16 h-16 object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.storage_path)}
                    className="absolute top-0 right-0 w-5 h-5 bg-black/60 hover:bg-black/80 text-white text-xs leading-none rounded-bl-md"
                    aria-label={`Remove ${a.filename}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {uploadingAttachment && (
                <div className="w-16 h-16 flex items-center justify-center text-xs text-white/60 bg-white/5 rounded-md">
                  …
                </div>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          {/* Input box — clean, full width. The toolbar (attach / templates /
              expand / send) sits below, mirroring the Hub composer. */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={(e) => {
                const filtered = filterTemplates(templates, pickerQuery)
                // Picker keyboard navigation takes priority when open.
                if (pickerOpen && filtered.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setPickerIndex((i) => (i + 1) % filtered.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setPickerIndex((i) => (i - 1 + filtered.length) % filtered.length)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    const t = filtered[Math.min(pickerIndex, filtered.length - 1)]
                    if (t) pickTemplate(t)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    closePicker()
                    return
                  }
                }
                // Desktop: Enter sends, Shift+Enter newline. Mobile: Enter newline.
                const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent)
                if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Type a text… (/ for templates)"
              rows={1}
              className={`w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm resize-none ${
                expanded ? 'h-[40vh]' : 'min-h-[40px] max-h-[120px]'
              }`}
              style={{ fontSize: 16 }}
              disabled={sending || !!conversation.contact?.do_not_text}
            />
            {pickerOpen && (
              <TemplatePicker
                templates={templates}
                query={pickerQuery}
                contactName={conversation.contact?.name || null}
                senderName={currentUserName}
                companyName={companyName}
                selectedIndex={pickerIndex}
                onIndexChange={setPickerIndex}
                onPick={pickTemplate}
                onClose={closePicker}
              />
            )}
            {/* On-My-Way + Schedule popovers — anchored to the full composer
                width (like the template picker) so they never run off-screen on
                mobile. Triggered from the toolbar buttons below. */}
            {omwOpen && !isGroup && conversation.contact && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#0F2E47] border border-white/10 rounded-md shadow-lg z-30 p-2">
                <div className="text-[11px] text-white/50 px-1 pb-1.5">
                  On my way — pick an ETA
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[5, 10, 15, 20, 30, 45].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => applyOnMyWay(m)}
                      className="px-2 py-1.5 rounded-md bg-white/5 hover:bg-emerald-600/40 text-sm"
                    >
                      {m}m
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={omwCustom}
                    onChange={(e) => setOmwCustom(e.target.value)}
                    placeholder="custom minutes"
                    className="flex-1 w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm"
                    style={{ fontSize: 16 }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const n = parseInt(omwCustom, 10)
                      if (Number.isFinite(n) && n >= 1 && n <= 240) applyOnMyWay(n)
                    }}
                    className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm"
                  >
                    Use
                  </button>
                </div>
              </div>
            )}
            {scheduleOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#0F2E47] border border-white/10 rounded-md shadow-lg z-30 p-3 max-h-[60vh] overflow-y-auto">
                <div className="text-[11px] text-white/50 pb-1.5">Schedule for later</div>
                <input
                  type="datetime-local"
                  min={minScheduleDateTime}
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm"
                  style={{ fontSize: 16 }}
                />
                <button
                  type="button"
                  onClick={scheduleMessage}
                  disabled={scheduling || !scheduleAt}
                  className="mt-2 w-full px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-50"
                >
                  {scheduling ? 'Scheduling…' : 'Schedule this message'}
                </button>
                {scheduledList.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-white/10 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-white/40">
                      Upcoming
                    </div>
                    {scheduledList.map((s) => (
                      <div key={s.id} className="flex items-start gap-2 text-[11px]">
                        <div className="flex-1 min-w-0">
                          <div className="text-white/70">
                            {new Date(s.send_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </div>
                          <div className="text-white/40 truncate">
                            {s.body || '📎 attachment'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelScheduled(s.id)}
                          className="text-white/40 hover:text-red-300 flex-none text-sm leading-none"
                          aria-label="Cancel scheduled message"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Toolbar — 📎 attach · 📋 templates · ⤢ expand · (spacer) · count · ➤ send */}
          <div className="flex items-center gap-1 mt-1.5">
            <button
              type="button"
              onClick={pickAttachments}
              disabled={sending || uploadingAttachment || !!conversation.contact?.do_not_text}
              className="text-white/50 hover:text-white disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Attach an image (JPEG/PNG/GIF/WebP, up to 5 MB)"
              aria-label="Attach image"
            >
              <span className="text-base leading-none">📎</span>
            </button>
            <button
              type="button"
              onClick={openPickerManually}
              disabled={sending || !!conversation.contact?.do_not_text}
              className="text-white/50 hover:text-white disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Insert template (or type / in the composer)"
              aria-label="Insert template"
            >
              <span className="text-base leading-none">📋</span>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setEmojiOpen((v) => !v)
                  setOmwOpen(false)
                  setScheduleOpen(false)
                }}
                disabled={sending || !!conversation.contact?.do_not_text}
                className="text-white/50 hover:text-white disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-white/10"
                title="Insert emoji"
                aria-label="Insert emoji"
              >
                <span className="text-base leading-none">😀</span>
              </button>
              {emojiOpen && (
                <EmojiPicker
                  align="left"
                  onSelect={insertEmojiAtCaret}
                  onClose={() => setEmojiOpen(false)}
                />
              )}
            </div>
            {!isGroup && conversation.contact && (
              <button
                type="button"
                onClick={() => {
                  setOmwOpen((v) => !v)
                  setScheduleOpen(false)
                  setEmojiOpen(false)
                  closePicker()
                }}
                disabled={sending || !!conversation.contact?.do_not_text}
                className={`hover:text-white disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-white/10 ${
                  omwOpen ? 'text-emerald-300 bg-white/10' : 'text-white/50'
                }`}
                title="On my way — pick an ETA"
                aria-label="On my way"
              >
                <span className="text-base leading-none">🚗</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-white/50 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title={expanded ? 'Shrink composer' : 'Expand composer'}
              aria-label={expanded ? 'Shrink composer' : 'Expand composer'}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                {expanded ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                )}
              </svg>
            </button>
            {/* Scheduled send — popover renders full-composer-width above the
                input (see the textarea wrapper). The count badge stays here. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setScheduleOpen((v) => !v)
                  setOmwOpen(false)
                  setEmojiOpen(false)
                  closePicker()
                }}
                disabled={sending || !!conversation.contact?.do_not_text}
                className={`relative hover:text-white disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-white/10 ${
                  scheduleOpen ? 'text-amber-300 bg-white/10' : 'text-white/50'
                }`}
                title="Schedule send"
                aria-label="Schedule send"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {scheduledList.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-amber-500 text-[9px] font-semibold text-white flex items-center justify-center">
                    {scheduledList.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex-1" />

            {/* ✨ Polish draft — Unified Inbox Session 5. Refines the user's own
                draft (never generates one). Active only when there's text and
                the contact isn't opted out. After polishing, an ↩ Undo restores
                the original draft until the user edits again. */}
            {polishUndo !== null ? (
              <button
                type="button"
                onClick={undoPolish}
                className="text-[11px] text-white/60 hover:text-white px-1.5 py-1 rounded-md hover:bg-white/10 mr-0.5"
                title="Undo polish — restore your original draft"
                aria-label="Undo polish"
              >
                ↩ Undo
              </button>
            ) : (
              <button
                type="button"
                onClick={runPolishDraft}
                disabled={polishLoading || !text.trim() || !!conversation.contact?.do_not_text}
                className="text-violet-300/80 hover:text-violet-200 disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-violet-500/15 mr-0.5"
                title="Polish my draft — clean up grammar &amp; tone"
                aria-label="Polish draft"
              >
                {polishLoading ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-violet-300 border-t-transparent rounded-full animate-spin align-middle" />
                ) : (
                  <span className="text-base leading-none">✨</span>
                )}
              </button>
            )}

            <span className="text-[10px] text-white/40 mr-1">
              {text.length > 0 && `${text.length}`}
              {selectedTemplateId && <span className="ml-1 text-emerald-300">· tmpl</span>}
            </span>

            <button
              onClick={sendMessage}
              disabled={
                sending ||
                (!text.trim() && pendingAttachments.length === 0) ||
                !!conversation.contact?.do_not_text
              }
              style={{ width: 34, height: 34 }}
              className="flex-none rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
              title="Send"
              aria-label="Send"
            >
              {sending ? (
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Claim — an unassigned (Queue) thread has no owner. Any Txt2 user can
          claim it (becomes owner), which reveals the composer. Claiming is
          explicit; replying no longer silently claims. */}
      {!isArchived && !canComposeHere && isUnassigned && (
        <div className="border-t border-white/10 px-4 py-3 bg-[#0B2237] flex items-center justify-between gap-3">
          <span className="text-sm text-white/50">
            Unclaimed conversation. Claim it to reply.
          </span>
          <button
            type="button"
            onClick={() => assignTo(currentUserId)}
            className="flex-none text-sm px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-white"
          >
            Claim it
          </button>
        </div>
      )}

      {/* Join-to-reply — shown to a Txt2 user viewing a thread owned by someone
          else. Reading is open to everyone; sending isn't. One click adds them
          as a member and reveals the composer. */}
      {!isArchived && !canComposeHere && !isUnassigned && (
        <div className="border-t border-white/10 px-4 py-3 bg-[#0B2237] flex items-center justify-between gap-3">
          <span className="text-sm text-white/50">
            {conversation.assignee && conversation.assignee.id !== currentUserId
              ? `You're viewing ${conversation.assignee.display_name.split(' ')[0]}'s conversation. Join it to send a reply.`
              : "You're viewing this conversation. Join it to send a reply."}
          </span>
          <button
            type="button"
            onClick={joinConversation}
            disabled={joining}
            className="flex-none text-sm px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white"
          >
            {joining ? 'Joining…' : 'Join to reply'}
          </button>
        </div>
      )}

      {isArchived && (
        <div className="border-t border-white/10 px-4 py-3 bg-amber-500/5 text-amber-200 text-sm text-center">
          {canArchive
            ? 'This conversation is archived. Tap ↺ above to reopen.'
            : 'This conversation is archived.'}
        </div>
      )}

      {/* Mobile notes overlay — the desktop rail is hidden on small screens, so
          on mobile the 📝 button opens this full-screen panel instead. */}
      {showNotes && (
        <div className="md:hidden fixed inset-0 z-50 bg-[#0B2237] flex flex-col">
          <div
            className="px-4 pb-3 border-b border-white/10 flex items-center justify-between"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
          >
            <span className="text-sm text-amber-300">Internal notes (not sent to customer)</span>
            <button
              onClick={() => setShowNotes(false)}
              className="text-white/50 hover:text-white text-xl leading-none"
              aria-label="Close notes"
            >
              ×
            </button>
          </div>
          {notesInner}
        </div>
      )}

      {/* Add-member picker — a centered modal (works on mobile, never clips off
          the right edge like the old absolute dropdown did). */}
      {addMemberOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4"
          onClick={() => setAddMemberOpen(false)}
        >
          <div
            className="bg-[#0F2E47] border border-white/10 rounded-lg w-full max-w-xs max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <h2 className="font-medium text-sm">Add to conversation</h2>
              <button
                onClick={() => setAddMemberOpen(false)}
                className="text-white/50 hover:text-white text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto py-1">
              {memberCandidates.length === 0 && (
                <div className="px-4 py-3 text-sm text-white/40">Everyone&apos;s already here.</div>
              )}
              {memberCandidates.map((u) => (
                <button
                  key={u.id}
                  onClick={() => addMember(u.id)}
                  className="block w-full text-left px-4 py-2.5 text-sm hover:bg-white/5"
                >
                  {u.display_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editContactOpen && conversation.contact && (
        <ContactModal
          mode="edit"
          contact={conversation.contact as ContactForModal}
          onClose={() => setEditContactOpen(false)}
          onSaved={(updated) => {
            setConversation({ ...conversation, contact: updated })
            setEditContactOpen(false)
          }}
        />
      )}
    </div>
  )
}
