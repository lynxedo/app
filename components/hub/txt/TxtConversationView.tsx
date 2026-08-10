'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ContactModal, { type ContactForModal } from './ContactModal'
import AddToTrackerModal from '@/components/hub/tracker/AddToTrackerModal'
import PopoutButton from '@/components/hub/popout/PopoutButton'
import TemplatePicker, { filterTemplates, type PickerTemplate } from './TemplatePicker'
import EmojiPicker from '@/components/hub/EmojiPicker'
import MediaLightbox, { type LightboxItem } from '@/components/hub/MediaLightbox'
import { createClient } from '@/lib/supabase/client'
import { renderTemplate, DEFAULT_ON_MY_WAY_TEMPLATE } from '@/lib/txt-templates'
import { CallMarker, VoicemailMarker, type TimelineCallEvent } from './TimelineMarkers'
import { formatPhone, initials } from '@/lib/format'
import { useOutsideClose } from '@/hooks/use-outside-close'
import { contactDisplayName, isPlaceholderName, nameIsAiGuessed } from '@/lib/contact-name'
import { lsaThreadLabel } from '@/lib/lsa-relay'

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
  /** Which contact sent an inbound (set by the webhooks). Group threads use it
   *  to label who said what. */
  contact_id?: string | null
  phone_number_id?: string | null
  rerouted?: boolean
  number?: { label: string | null; twilio_number: string } | { label: string | null; twilio_number: string }[] | null
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
  name_source?: string | null
  name_prompt_dismissed_at?: string | null
  phone: string
  email: string | null
  do_not_text: boolean
  jobber_client_id: string | null
  in_directory?: boolean
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
  // Google Local Services relay — see lib/lsa-relay.ts.
  lsa_relay?: boolean | null
  lsa_location?: string | null
  lsa_service?: string | null
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

/**
 * A teammate as a compact circle — their Hub profile photo when they have one,
 * their initials when they don't. Replaces the old first-name-plus-× text chips
 * in the conversation header, which cost ~65px each and wrapped the header onto
 * three rows on a phone.
 *
 * The members payload carries no avatar_url, so we optimistically request the
 * profile-avatar endpoint and fall back to initials on error (same approach as
 * the Hub MessageFeed avatar). A miss is one cheap 404 the browser then caches.
 */
function UserCircle({
  userId,
  name,
  size = 24,
  ring,
  title,
}: {
  userId: string
  name: string
  size?: number
  /**
   * REPLACES the default outline (don't append — two Tailwind `ring-*` widths
   * on one element fight each other). Used to give the owner a green ring.
   */
  ring?: string
  title?: string
}) {
  const [imgError, setImgError] = useState(false)
  const outline = ring || 'ring-1 ring-inset ring-white/15'
  const common = 'rounded-full flex-none object-cover'
  const style = { width: size, height: size }
  if (!imgError) {
    return (
      <img
        src={`/api/profile/avatar/${userId}`}
        alt=""
        title={title || name}
        style={style}
        className={`${common} ${outline}`}
        onError={() => setImgError(true)}
      />
    )
  }
  return (
    <span
      title={title || name}
      style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.38)) }}
      className={`${common} inline-flex items-center justify-center font-bold text-[#fff] bg-gradient-to-br from-slate-500 to-slate-700 ${outline}`}
    >
      {initials(name)}
    </span>
  )
}

/** Shared look for the square icon actions in the conversation header. */
const HDR_ICON_BTN =
  'w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex-none inline-flex items-center justify-center text-sm relative'

// Classify an MMS attachment by file extension. The inbound webhook stores R2
// keys with an extension derived from Twilio's Content-Type (image/jpeg→.jpeg,
// video/quicktime→.quicktime, video/mp4→.mp4, etc.), and outbound uploads keep
// their original name, so extension is a reliable signal.
function mediaKind(mu: string): 'image' | 'video' | 'pdf' | 'other' {
  const u = mu.toLowerCase()
  if (/\.(jpe?g|png|gif|webp|heic|heif|bmp)(?:[?#]|$)/.test(u)) return 'image'
  if (/\.(mp4|mov|m4v|webm|3gp|3gpp|quicktime|avi|mpeg|mpg|ogg)(?:[?#]|$)/.test(u)) return 'video'
  if (/\.pdf(?:[?#]|$)/.test(u)) return 'pdf'
  return 'other'
}

// Map a Twilio delivery failure (stored raw in txt_messages.error_message —
// usually just the numeric code) to a short plain-English reason, so staff can
// tell a non-textable number from a transient/technical failure at a glance.
// `hard` = the number/contact won't accept texts; `soft` = try again / technical.
function friendlyDeliveryError(raw: string): { label: string; hard: boolean } {
  const code = raw.trim()
  switch (code) {
    case '30006': return { label: '🚫 Landline — can’t receive texts', hard: true }
    case '30005': return { label: '🚫 Number invalid or unreachable', hard: true }
    case '30004': return { label: '🚫 Message blocked by the carrier', hard: true }
    case '21610': return { label: '🚫 Contact opted out (texted STOP)', hard: true }
    case '30003': return { label: '⚠ Phone unreachable (off / no signal) — may work later', hard: false }
    case '30007': return { label: '⚠ Blocked by carrier filtering', hard: false }
    case '30002': return { label: '⚠ Account issue — couldn’t send', hard: false }
  }
  if (/invalid .*phone number/i.test(code)) return { label: '🚫 Bad phone number', hard: true }
  if (/not configured/i.test(code)) return { label: 'Not sent — texting not configured (staging)', hard: false }
  if (/^\d{4,6}$/.test(code)) return { label: `Delivery failed (code ${code})`, hard: false }
  return { label: code || 'Delivery failed', hard: false }
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
      return <span className="text-[var(--t-tint-success)]">✓✓</span>
    case 'failed':
      return <span className="text-[var(--t-tint-danger)]">⚠</span>
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
  assistantName = null,
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
  /**
   * The company's configured AI assistant name (Admin → AI → Assistant). Used
   * to label AI-sent texts and the auto-reply markers, so a renamed assistant
   * doesn't still read "Guardian" in the thread. Null → a neutral fallback.
   */
  assistantName?: string | null
}) {
  const router = useRouter()
  const aiName = assistantName?.trim() || 'Assistant'
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
  // Header popovers. `membersOpen` = the manage-members list behind the member
  // avatar cluster; `moreOpen` = the ⋯ menu holding archive + the one-time and
  // rarely-changed actions that used to sit in the (wrapping) header row.
  const [membersOpen, setMembersOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [editContactOpen, setEditContactOpen] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [namePromptDismissed, setNamePromptDismissed] = useState<boolean>(!!initialConversation.contact?.name_prompt_dismissed_at)
  const [trackerOpen, setTrackerOpen] = useState(false)
  const [trackerLeadId, setTrackerLeadId] = useState<string | null>(null)
  const [numbers, setNumbers] = useState<PhoneNumberOption[]>([])
  const [numberPickerOpen, setNumberPickerOpen] = useState(false)
  // Pending MMS attachments — staged client-side via the 📎 button, sent in
  // media_urls on next sendMessage(). Each item is the storage_path returned
  // by /api/txt/upload (Twilio fetches via /api/txt/media/[...key]).
  const [pendingAttachments, setPendingAttachments] = useState<
    { storage_path: string; filename: string; preview: string; kind: 'image' | 'video' | 'pdf' | 'other' }[]
  >([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  // "Add to Board" — turn a customer text into a task card on a Hub board.
  // boardPickerFor holds the text body being forwarded (null = closed); we list
  // the user's boards on open and POST content-only (no forwarded_from_message_id
  // — that FK points at the Hub `messages` table, not txt_messages).
  const [boardPickerFor, setBoardPickerFor] = useState<string | null>(null)
  const [boardPickerBoards, setBoardPickerBoards] = useState<{ id: string; name: string }[]>([])
  const [addingToBoard, setAddingToBoard] = useState(false)
  const [boardAddedFor, setBoardAddedFor] = useState<string | null>(null)
  // In-app media viewer (#3) — images + PDFs open here instead of a new browser
  // tab (which returns null in the iOS Capacitor webview, so taps did nothing).
  // Videos play inline in the bubble, mirroring Hub DMs/Rooms.
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Popover containers, for click-outside/Escape dismissal (useOutsideClose).
  const ownerRef = useRef<HTMLDivElement>(null)
  const membersRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const aiRef = useRef<HTMLDivElement>(null)
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
  // and hasGuardian (prop from page). Picking a tone fires /suggest-reply and
  // inserts the response in the composer, prompting before clobbering an
  // existing draft. Now reached from the merged composer ✨ (see `aiOpen`)
  // rather than its own header button.
  const [suggestLoading, setSuggestLoading] = useState(false)
  // Open state for the ONE merged AI menu in the composer (write + polish).
  const [aiOpen, setAiOpen] = useState(false)

  // Dismiss each popover on an outside click or Escape. Opening one while
  // another is open works for free: the mousedown on the second trigger lands
  // outside the first, closing it before the second opens.
  useOutsideClose(ownerRef, assignOpen, () => setAssignOpen(false))
  useOutsideClose(membersRef, membersOpen, () => setMembersOpen(false))
  useOutsideClose(moreRef, moreOpen, () => setMoreOpen(false))
  // The number picker shares the ⋯ container (it's opened from that menu).
  useOutsideClose(moreRef, numberPickerOpen, () => setNumberPickerOpen(false))
  useOutsideClose(aiRef, aiOpen, () => setAiOpen(false))
  // Archiving unmounts the whole composer; without this the AI menu would still
  // be flagged open and pop straight back up if the thread is reopened.
  // (Reads conversation.status directly — `isArchived` is derived further down.)
  useEffect(() => {
    if (conversation.status === 'archived') setAiOpen(false)
  }, [conversation.status])

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
  // (AI-help gates are derived further down, once `text` and `messages` exist.)
  const canArchive = isOwnerMe || canAssign

  // Google Local Services relay threads arrive on Google's per-lead proxy number
  // with no customer name, so "Unknown" is all we could otherwise show. Label them
  // by the lead instead (city · service). Null for every normal thread, which
  // leaves the usual "Unknown" fallback untouched.
  const lsaFallbackLabel = conversation.lsa_relay
    ? lsaThreadLabel(conversation.lsa_location ?? null, conversation.lsa_service ?? null)
    : null

  async function runSuggestReply(tone: SuggestTone) {
    setAiOpen(false)
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
      // Stash the ORIGINAL only once. Undo used to replace the polish button
      // outright, so a second polish was impossible; now they sit side by side,
      // and re-stashing here would overwrite what the user actually typed with
      // the already-polished version — silently losing their words. Keep the
      // first stash until they Undo or edit (handleTextChange clears it).
      setPolishUndo((prev) => (prev === null ? text : prev))
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

  // Keep the cursor ready to type: focus the composer when a thread opens
  // (desktop only — autofocusing on mobile would pop the keyboard over the
  // thread) and again after each send completes. sendMessage can't focus
  // synchronously because the textarea is disabled={sending} at that instant,
  // so this refocuses once React re-enables it.
  const wasSendingRef = useRef(false)
  useEffect(() => {
    if (wasSendingRef.current && !sending) textareaRef.current?.focus()
    wasSendingRef.current = sending
  }, [sending])
  useEffect(() => {
    const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent)
    if (!isMobile) textareaRef.current?.focus()
  }, [conversation.id])

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
    // Call + voicemail markers now show for everyone who can open the thread
    // (Ben's call, June 19) — not just Unified Inbox flag holders. Direct
    // threads only; groups have no single contact and stay text-only (PRD §7.3).
    const contactId = conversation.contact?.id
    if (isGroup || !contactId) {
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
  }, [isGroup, conversation.contact?.id, companyId])

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

  // Shared uploader for both the 📎 picker and clipboard paste.
  async function uploadAttachmentFiles(files: File[]) {
    if (files.length === 0) return
    setSendError('')
    setUploadingAttachment(true)
    for (const file of files) {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/txt/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSendError(data.error || `Upload failed for ${file.name || 'image'}`)
        continue
      }
      // Local object URL for the chip preview — never persisted, freed on send.
      const preview = URL.createObjectURL(file)
      const mime: string = data.mime_type || file.type || ''
      const kind: 'image' | 'video' | 'pdf' | 'other' =
        mime.startsWith('image/') ? 'image'
        : mime.startsWith('video/') ? 'video'
        : mime === 'application/pdf' ? 'pdf'
        : 'other'
      setPendingAttachments((prev) => [
        ...prev,
        { storage_path: data.storage_path, filename: data.filename, preview, kind },
      ])
    }
    setUploadingAttachment(false)
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return
    await uploadAttachmentFiles(Array.from(files))
    // Reset input so re-selecting the same file fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Paste an image straight into the composer (e.g. a screenshot) — uploads it
  // as an MMS attachment, mirroring the 📎 button. Only intercepts when the
  // clipboard actually carries image files, so normal text paste is untouched.
  async function handleComposerPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (sending || conversation.contact?.do_not_text) return
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length === 0) return // let text paste through normally
    e.preventDefault()
    await uploadAttachmentFiles(imageFiles)
  }

  function removeAttachment(storage_path: string) {
    setPendingAttachments((prev) => {
      const target = prev.find((p) => p.storage_path === storage_path)
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter((p) => p.storage_path !== storage_path)
    })
  }

  // Open the board picker for a given message body, fetching the user's boards.
  function openBoardPicker(body: string) {
    setBoardPickerFor(body)
    setBoardPickerBoards([])
    fetch('/api/hub/boards')
      .then((r) => r.json())
      .then((d) => setBoardPickerBoards(d.boards ?? []))
      .catch(() => {})
  }

  // Create a board item from the open text. Prefix with the contact's name so
  // the card carries context once it leaves the conversation.
  async function addTextToBoard(boardId: string) {
    if (boardPickerFor == null) return
    const who = conversation.contact?.name?.trim() || 'a customer'
    const content = `Text from ${who}: ${boardPickerFor}`
    setAddingToBoard(true)
    try {
      const res = await fetch(`/api/hub/boards/${boardId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSendError(data.error || 'Couldn’t add to board')
      } else {
        setBoardAddedFor(boardPickerFor)
        setTimeout(() => setBoardAddedFor(null), 2500)
      }
    } finally {
      setAddingToBoard(false)
      setBoardPickerFor(null)
    }
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
      // Reopening a direct thread claims it for me (server seats me as owner) so
      // the composer appears in one tap — reflect that ownership locally too.
      const claimedByMe =
        !archived && !isGroup && data.conversation.assigned_to === currentUserId
      setConversation({
        ...conversation,
        status: data.conversation.status,
        assigned_to: data.conversation.assigned_to,
        assignee: claimedByMe
          ? { id: currentUserId, display_name: currentUserName || 'You' }
          : conversation.assignee,
      })
      if (claimedByMe) {
        setMembers((prev) => [
          // Drop the prior owner + any stale seat for me, then seat me as owner.
          ...prev.filter((m) => m.role !== 'owner' && m.user_id !== currentUserId),
          {
            user_id: currentUserId,
            role: 'owner',
            user: { id: currentUserId, display_name: currentUserName || 'You' },
          },
        ])
      }
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
    // If the template carries an attachment, stage it so it sends with the body.
    // We already have the storage_path; preview straight off the durable media
    // route (no File needed). Skip any already-staged copy of the same path.
    if (t.media && t.media.length) {
      setPendingAttachments((prev) => {
        const have = new Set(prev.map((p) => p.storage_path))
        const additions = t.media!
          .filter((sp) => !have.has(sp))
          .map((sp) => ({
            storage_path: sp,
            filename: sp.split('/').pop() || 'attachment',
            preview: `/api/txt/media/${sp}`,
            kind: mediaKind(sp),
          }))
        return [...prev, ...additions]
      })
    }
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
  // Which halves of the merged composer ✨ apply right now. WRITING needs a
  // Guardian tier plus something to reply to; POLISHING just needs a draft (and
  // is open to any Txt user who can send here). Both refuse an opted-out
  // contact. These are deliberately the same conditions the two separate
  // buttons used, so no one gains or loses access in the merge.
  const canSuggestReply =
    hasGuardian &&
    canReplyHere &&
    !isArchived &&
    messages.length > 0 &&
    !conversation.contact?.do_not_text
  const canPolishDraft = !!text.trim() && !conversation.contact?.do_not_text
  const aiBusy = suggestLoading || polishLoading
  // Archive/Reopen is a VISIBLE header icon (it's used constantly); the rest of
  // these gate rows inside the ⋯ menu. The menu itself needs no "is it empty?"
  // guard because internal notes are ungated, so there's always one item.
  const canArchiveOrReopen = isArchived || canArchive
  const canCatchMeUp =
    canAccessUnifiedInbox && !isGroup && (messages.length > 0 || callEvents.length > 0)
  const canPickSendNumber = numbers.length >= 2 && canReplyHere
  const phoneDisplay = conversation.contact ? formatPhone(conversation.contact.phone) : ''
  // A hidden inbound stub (in_directory === false) isn't in the official
  // directory yet. Offer a one-tap "Add to Contacts" that graduates it (POST
  // /api/txt/contacts adopts the row by phone, keeping full history).
  const contactInDirectory = conversation.contact?.in_directory !== false
  const contactNameIsPlaceholder = isPlaceholderName(
    conversation.contact?.name,
    conversation.contact?.phone,
  )
  // Nudge to name an "Unknown" contact — shown once per contact (dismissible),
  // never re-nagging (item 5). Skipped for groups.
  const showNamePrompt =
    !isGroup && !!conversation.contact && contactNameIsPlaceholder && !namePromptDismissed
  function dismissNamePrompt() {
    setNamePromptDismissed(true)
    const cid = conversation.contact?.id
    if (cid) {
      void fetch(`/api/txt/contacts/${cid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss_name_prompt: true }),
      })
    }
  }
  function openNameEditor() {
    if (contactInDirectory) setEditContactOpen(true)
    else setAddContactOpen(true)
  }
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
      {/* On a PHONE the identity block gets its own row and the actions sit
          underneath, so the contact's full name and number are always readable
          — no amount of members/owner/actions can squeeze them. On sm+ there's
          width for everything on one line, so it collapses back to a single
          row. (Trying to fit both on one row at 375px can't be guaranteed: a
          long name plus a full action cluster will always overflow eventually.) */}
      <div
        data-hide-on-keyboard
        className="px-4 py-2 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 bg-[var(--t-panel-deep)]"
      >
        {isGroup ? (
          <div className="w-full sm:flex-1 min-w-0 text-left">
            <div className="font-medium flex items-center gap-1.5 min-w-0">
              <span>👥</span>
              <span className="truncate">
                {groupContacts.length === 0
                  ? 'Group'
                  : groupContacts
                      .slice(0, 3)
                      .map((c) => (c.name || 'Unknown').split(' ')[0])
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
            onClick={() =>
              conversation.contact &&
              (contactInDirectory ? setEditContactOpen(true) : setAddContactOpen(true))
            }
            disabled={!conversation.contact}
            className="w-full sm:flex-1 min-w-0 text-left -ml-1 px-1 py-0.5 rounded hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent"
            title={
              conversation.contact
                ? contactInDirectory
                  ? 'Edit contact'
                  : 'Add to contacts'
                : undefined
            }
          >
            {/* The name lives in its own `truncate` span, NOT directly in the
                flex row: text-overflow:ellipsis doesn't apply to a flex
                container's anonymous text child, so a long name was being
                hard-clipped mid-letter with no "…" — reading as a rendering
                bug rather than as truncation. */}
            <div className="font-medium flex items-center gap-1.5 min-w-0">
              <span className="truncate">
                {contactDisplayName(conversation.contact?.name, conversation.contact?.phone, lsaFallbackLabel)}
              </span>
              {nameIsAiGuessed(conversation.contact?.name_source) && (
                <span className="w-2 h-2 rounded-full bg-purple-400 flex-none" title="Name suggested by AI — tap to confirm" />
              )}
            </div>
            <div className="text-xs text-white/50 truncate">{phoneDisplay}</div>
          </button>
        )}
        {/* Actions. On a phone this is its own row under the name: people on
            the left, actions on the right. On sm+ it's the right-hand end of a
            single-row header. Only the controls used on most threads stay
            visible; one-time and rare ones live behind ⋯. */}
        <div className="flex items-center gap-1.5 flex-none w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center gap-1.5">
          {/* OWNER. Assigned → an avatar with a green ring (the old
              "Owner: Kathryn" pill cost ~90px). Genuinely UNASSIGNED (a Queue
              thread) → still a loud labelled pill, because an avatar cannot say
              "nobody has this yet" and claiming out of the Queue depends on
              that being obvious. A thread that merely lost its assignee without
              going back to the Queue gets a NEUTRAL "Unassigned" — it used to
              read that way, and showing a loud "+ Assign" there would promise
              an action the assign menu doesn't actually offer for it. */}
          {(() => {
            const owner = conversation.assignee
            const ownerIsMe = owner?.id === currentUserId
            const ownerName = ownerIsMe ? currentUserName || owner!.display_name : owner?.display_name || ''
            // Can this person actually change the assignment? Mirrors the old
            // disabled condition. When they can't, the button still has a job:
            // it reveals WHO owns the thread (see below).
            const canChangeAssignment =
              canAssign || conversation.assigned_to === currentUserId || conversation.status === 'unassigned'
            const label = isUnassigned
              ? 'Unassigned — tap to claim or assign'
              : owner
              ? `Owner: ${ownerIsMe ? 'You' : owner.display_name}`
              : 'Unassigned'
            return (
              <div ref={ownerRef} className="relative flex-none">
                <button
                  onClick={() => {
                    setMoreOpen(false)
                    setNumberPickerOpen(false)
                    // A rep who can't reassign still needs to SEE who owns the
                    // thread — on a phone there's no hover, so `title` alone
                    // told them nothing and the old text chip ("Owner: Kathryn")
                    // is gone. Send them to the members panel, which lists the
                    // owner by name.
                    if (!canChangeAssignment) {
                      setMembersOpen((v) => !v)
                      return
                    }
                    setAssignOpen((v) => !v)
                    setMembersOpen(false)
                  }}
                  className={
                    isUnassigned
                      ? 'text-xs px-2 py-1 rounded-md bg-orange-500/20 text-[var(--t-tint-orange)] hover:bg-orange-500/30 whitespace-nowrap'
                      : owner
                      ? 'rounded-full p-1 -m-0.5 hover:bg-white/10 transition-colors'
                      : 'text-xs px-2 py-1 rounded-md bg-white/10 text-white/60 hover:bg-white/20 whitespace-nowrap'
                  }
                  title={label}
                  aria-label={label}
                >
                  {isUnassigned ? (
                    '+ Assign'
                  ) : owner ? (
                    <UserCircle
                      /* Keyed by owner id: this component caches an `imgError`
                         flag, so without a key a reassignment would reuse the
                         previous owner's failed-image state and render the new
                         owner as initials even when they have a photo. */
                      key={owner.id}
                      userId={owner.id}
                      name={ownerName}
                      size={26}
                      ring="ring-2 ring-emerald-400/60"
                      title={label}
                    />
                  ) : (
                    'Unassigned'
                  )}
                </button>
                {assignOpen && (
                  <>
                    <div className="absolute left-0 mt-1 w-56 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 max-h-80 overflow-y-auto">
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
                              className="block w-full text-left px-3 py-2 text-sm text-[var(--t-tint-orange)] hover:bg-white/5 border-t border-white/10"
                            >
                              Unassign
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })()}

          {/* MEMBERS — overlapping circles instead of one first-name-plus-×
              chip each (~66px for three, vs ~132px for two as text). Tapping
              the cluster opens the manage popover: a 10px × inside a 24px
              circle is far below a usable tap target, so add/remove/leave all
              live in there now. */}
          {(memberRows.length > 0 ||
            (canManageMembers && memberCandidates.length > 0) ||
            (isMemberMe && !isOwnerMe)) && (
            <div ref={membersRef} className="relative flex-none">
              <button
                type="button"
                onClick={() => {
                  setMembersOpen((v) => !v)
                  setAssignOpen(false)
                  setMoreOpen(false)
                  setNumberPickerOpen(false)
                }}
                className="flex items-center pl-0.5 pr-1 py-1 rounded-full hover:bg-white/10"
                title={
                  memberRows.length > 0
                    ? `On this thread: ${memberRows
                        .map((m) => unwrap(m.user)?.display_name || 'teammate')
                        .join(', ')}`
                    : 'Add a teammate to this thread'
                }
                aria-label={
                  canManageMembers && memberCandidates.length > 0
                    ? 'Thread members — add or remove'
                    : 'Thread members'
                }
              >
                {memberRows.slice(0, 2).map((m, i) => {
                  const u = unwrap(m.user)
                  return (
                    <span key={m.user_id} className={i > 0 ? '-ml-2' : ''}>
                      <UserCircle
                        userId={m.user_id}
                        name={u?.display_name || 'teammate'}
                        size={24}
                        ring="ring-2 ring-[var(--t-panel-deep)]"
                      />
                    </span>
                  )
                })}
                {memberRows.length > 2 && (
                  <span
                    className="-ml-2 w-6 h-6 rounded-full inline-flex items-center justify-center text-[9px] font-bold bg-white/15 text-white/75 ring-2 ring-[var(--t-panel-deep)]"
                    title={memberRows
                      .slice(2)
                      .map((m) => unwrap(m.user)?.display_name || 'teammate')
                      .join(', ')}
                  >
                    +{memberRows.length - 2}
                  </span>
                )}
                {canManageMembers && memberCandidates.length > 0 && (
                  /* Always shown now. It used to hide on mobile to buy width for
                     the contact's name, but the name has its own row there, so
                     there's nothing left to compete with. */
                  <span
                    aria-hidden
                    className={`${
                      memberRows.length > 0 ? 'ml-1' : ''
                    } w-6 h-6 rounded-full inline-flex items-center justify-center text-xs border border-dashed border-white/30 text-white/55`}
                  >
                    +
                  </span>
                )}
              </button>
              {membersOpen && (
                <>
                  <div className="absolute left-0 mt-1 w-60 max-w-[calc(100vw-2rem)] bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 max-h-80 overflow-y-auto">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-white/40 border-b border-white/10">
                      On this thread
                    </div>
                    {/* The OWNER is listed first, by name. The header shows them
                        as a bare avatar now, and there's no hover on a phone —
                        this is where anyone (including a rep who can't
                        reassign) finds out whose thread it is. */}
                    {conversation.assignee && (
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                        <UserCircle
                          key={conversation.assignee.id}
                          userId={conversation.assignee.id}
                          name={conversation.assignee.display_name}
                          size={22}
                          ring="ring-2 ring-emerald-400/60"
                        />
                        <span className="text-sm truncate flex-1 min-w-0">
                          {conversation.assignee.display_name}
                          {conversation.assignee.id === currentUserId && (
                            <span className="text-white/40"> (you)</span>
                          )}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-[var(--t-tint-success)] flex-none">
                          Owner
                        </span>
                      </div>
                    )}
                    {memberRows.length === 0 && (
                      <div className="px-3 py-2.5 text-sm text-white/40">
                        No one else yet.
                      </div>
                    )}
                    {memberRows.map((m) => {
                      const u = unwrap(m.user)
                      const isMe = m.user_id === currentUserId
                      const canRemoveThis = canManageMembers || isMe
                      return (
                        <div key={m.user_id} className="flex items-center gap-2 px-3 py-2">
                          <UserCircle
                            userId={m.user_id}
                            name={u?.display_name || 'teammate'}
                            size={22}
                          />
                          <span className="text-sm truncate flex-1 min-w-0">
                            {u?.display_name || 'teammate'}
                            {isMe && <span className="text-white/40"> (you)</span>}
                          </span>
                          {canRemoveThis && (
                            <button
                              type="button"
                              onClick={() => {
                                removeMember(m.user_id)
                                setMembersOpen(false)
                              }}
                              className="text-xs px-2.5 py-1.5 rounded text-[var(--t-tint-orange)] hover:bg-white/10 flex-none"
                            >
                              {isMe ? 'Leave' : 'Remove'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {canManageMembers && memberCandidates.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setAddMemberOpen(true)
                          setMembersOpen(false)
                        }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5 border-t border-white/10"
                      >
                        + Add teammate
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          </div>

          {/* Right-hand group: the actions. */}
          <div className="flex items-center gap-1.5">
          {/* Call — Session 57. Direct DMs only, contact has a phone, user has
              Dialer access. Navigates to /hub/dialer with the number pre-filled
              and conversation_id + contact_id passed through so the resulting
              calls row links back to this Txt thread. The user still taps the
              green Call button in the Dialer to actually dial. */}
          {canAccessDialer && !isGroup && conversation.contact?.phone && (
            <button
              onClick={startCall}
              className={`${HDR_ICON_BTN} bg-emerald-500/15 text-[var(--t-tint-success)] hover:bg-emerald-500/25`}
              title="Call this contact in the Dialer"
              aria-label="Call"
            >
              📞
            </button>
          )}

          {/* Archive / Reopen — kept VISIBLE (it moved out of the ⋯ menu):
              closing out a thread is a constant, and burying it cost a tap on
              the most-used action in the header. Reopen (↺) is available to any
              Txt teammate — a rep must be able to re-engage an archived
              customer; archiving (✓) stays owner/manager-only. */}
          {canArchiveOrReopen && (
            <button
              onClick={toggleArchive}
              className={`${HDR_ICON_BTN} bg-white/10 hover:bg-white/20 text-white/75`}
              title={isArchived ? 'Reopen conversation' : 'Archive conversation'}
              aria-label={isArchived ? 'Reopen conversation' : 'Archive conversation'}
            >
              <span aria-hidden>{isArchived ? '↺' : '✓'}</span>
            </button>
          )}

          {/* Pop out into a floating always-on-top window. Left ungated on
              purpose: PopoutButton renders NOTHING unless Document
              Picture-in-Picture is supported, which is Chromium desktop (and
              the Electron app) only — so it already costs zero width on a
              phone. Hiding it below a breakpoint would only take the feature
              away from desktop users running a narrow window, and this header
              is its one and only entry point for a Txt thread. */}
          <PopoutButton
            target={{
              kind: 'txt',
              id: conversation.id,
              title: contactDisplayName(conversation.contact?.name, conversation.contact?.phone, lsaFallbackLabel),
              companyId,
            }}
          />

          {/* ⋯ — internal notes plus the one-time and rarely-changed actions.
              Always rendered: Notes is ungated, so the menu can never be empty. */}
          <div ref={moreRef} className="relative flex-none">
            <button
              type="button"
              onClick={() => {
                setMoreOpen((v) => !v)
                setAssignOpen(false)
                setMembersOpen(false)
                setNumberPickerOpen(false)
              }}
              className={`${HDR_ICON_BTN} bg-white/10 hover:bg-white/20 text-white/75`}
              title={
                notes.length > 0
                  ? `More actions — ${notes.length} internal note${notes.length === 1 ? '' : 's'}`
                  : 'More actions'
              }
              aria-label={
                notes.length > 0
                  ? `More actions, ${notes.length} internal note${notes.length === 1 ? '' : 's'}`
                  : 'More actions'
              }
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
              {/* Notes moved into this menu, so surface their count out here —
                  otherwise "this thread has notes" became invisible. */}
              {notes.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-amber-600 text-[9px] font-bold text-[#fff] flex items-center justify-center ring-2 ring-[var(--t-panel-deep)]">
                  {notes.length}
                </span>
              )}
            </button>
            {moreOpen && (
              <>
                <div className="absolute right-0 mt-1 w-60 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 max-h-96 overflow-y-auto">
                  {/* Internal notes — the panel toggle. Ungated, so this is the
                      item that guarantees the menu is never empty. */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowNotes((v) => !v)
                      setMoreOpen(false)
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${
                      notes.length > 0 ? 'text-[var(--t-tint-warning)]' : ''
                    }`}
                  >
                    📝 {showNotes ? 'Hide notes' : 'Internal notes'}
                    {notes.length > 0 && ` (${notes.length})`}
                  </button>
                  {/* Catch me up — read-only AI roll-up of the whole
                      relationship. Behind can_access_unified_inbox; direct
                      threads only and only when there's history. */}
                  {canCatchMeUp && (
                    <button
                      type="button"
                      onClick={() => {
                        runCatchMeUp()
                        setMoreOpen(false)
                      }}
                      disabled={catchLoading}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-60"
                    >
                      🧭 {catchOpen ? 'Hide recap' : 'Catch me up'}
                    </button>
                  )}
                  {/* Customer file — the full CRM account page for this
                      contact. It lives here rather than on the header name,
                      which already owns edit-contact. Shown for any contact,
                      in-directory or not: the page reads the same txt_contacts
                      row either way. */}
                  {!isGroup && conversation.contact && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false)
                        // router.push, not an <a>: the Contacts list opens this
                        // same page the same way, and a hard href would tear
                        // down and re-bootstrap the whole Hub shell.
                        router.push(`/hub/contacts/${conversation.contact!.id}`)
                      }}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                    >
                      👤 Customer file
                    </button>
                  )}
                  {/* Not-in-directory → one-tap graduate to the contacts directory */}
                  {!isGroup && conversation.contact && !contactInDirectory && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddContactOpen(true)
                        setMoreOpen(false)
                      }}
                      className="block w-full text-left px-3 py-2 text-sm text-[var(--t-tint-success)] hover:bg-white/5"
                    >
                      + Add to Contacts
                    </button>
                  )}
                  {/* Lead Tracker link — flips to a view link once linked. */}
                  {!isGroup && conversation.contact &&
                    (trackerLeadId ? (
                      <a
                        href="/hub/tracker"
                        className="block w-full text-left px-3 py-2 text-sm text-[var(--t-tint-success)] hover:bg-white/5"
                        onClick={() => setMoreOpen(false)}
                      >
                        ✓ In tracker — view
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTrackerOpen(true)
                          setMoreOpen(false)
                        }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                      >
                        + Add to Lead Tracker
                      </button>
                    ))}
                  {/* From-number picker. Only when 2+ numbers exist, so
                      single-number setups never see it. */}
                  {canPickSendNumber && (
                    <button
                      type="button"
                      onClick={() => {
                        setNumberPickerOpen(true)
                        setMoreOpen(false)
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 border-t border-white/10 flex items-center gap-2"
                    >
                      <span className="flex-1">Send from…</span>
                      <span className="text-[11px] text-white/45 truncate max-w-[92px]">
                        {(() => {
                          const current = numbers.find((n) => n.id === conversation.phone_number_id)
                          if (current) return current.label || formatPhone(current.twilio_number)
                          const def = numbers.find((n) => n.is_default)
                          return def ? `${def.label || formatPhone(def.twilio_number)} (default)` : '—'
                        })()}
                      </span>
                    </button>
                  )}
                </div>
              </>
            )}
            {numberPickerOpen && (
              <>
                <div className="absolute right-0 mt-1 w-60 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 max-h-72 overflow-y-auto">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-white/40 border-b border-white/10">
                    Send from
                  </div>
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
                        n.id === conversation.phone_number_id ? 'bg-white/5 text-[var(--t-tint-success)]' : ''
                      }`}
                    >
                      <div className="text-sm">{n.label || formatPhone(n.twilio_number)}</div>
                      {n.label && (
                        <div className="text-[10px] text-white/40">{formatPhone(n.twilio_number)}</div>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Catch me up — collapsible summary panel below the header. Renders only
          while open; a fresh roll-up is fetched each time it's opened. */}
      {catchOpen && (
        <div className="px-4 py-2.5 bg-sky-500/10 border-b border-sky-500/25 text-sm flex items-start gap-2">
          <span aria-hidden className="mt-0.5">🧭</span>
          <div className="flex-1 min-w-0">
            {catchLoading ? (
              <span className="text-[var(--t-tint-info)]">Catching you up…</span>
            ) : catchError ? (
              <span className="text-[var(--t-tint-orange)]">{catchError}</span>
            ) : (
              <span className="text-sky-50/90 whitespace-pre-wrap">{catchSummary}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCatchOpen(false)}
            className="flex-none text-[var(--t-tint-info)] hover:text-[var(--t-tint-info)] text-xs px-1"
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
        <div className="px-4 py-2 bg-orange-500/15 border-b border-orange-500/30 text-[var(--t-tint-orange)] text-sm flex items-center gap-2">
          <span aria-hidden>🚫</span>
          <span>
            This contact opted out — they&apos;re on the do-not-text list. Outbound texts are blocked.
          </span>
        </div>
      )}

      {showNamePrompt && (
        <div className="px-4 py-2 bg-sky-500/10 border-b border-sky-500/25 text-sm flex items-center gap-2">
          <span aria-hidden>🏷️</span>
          <span className="flex-1 text-white/80">This contact doesn&apos;t have a name yet. Add one so it&apos;s easy to find.</span>
          <button type="button" onClick={openNameEditor}
            className="px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-[#fff] text-xs font-medium flex-none">Add a name</button>
          <button type="button" onClick={dismissNamePrompt} title="Dismiss"
            className="px-1.5 py-1 rounded-md text-white/40 hover:text-white flex-none">✕</button>
        </div>
      )}

      {/* Body: messages + optional notes panel */}
      <div className="flex-1 flex min-h-0">
        <div
          ref={scrollContainerRef}
          style={{ visibility: feedReady ? 'visible' : 'hidden', overscrollBehaviorX: 'none' }}
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-2"
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
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[var(--t-tint-warning)] text-[10px] hover:bg-amber-500/20 max-w-[85%]"
                    title="Internal note — tap to view"
                  >
                    <span aria-hidden>📝</span>
                    <span className="flex-none">Note · {formatTime(n.created_at)}</span>
                    {n.body && <span className="text-[var(--t-tint-warning)] truncate">— {n.body}</span>}
                  </button>
                </div>
              )
            }
            if (item.kind === 'event') {
              const e = item.event
              return e.kind === 'voicemail' ? (
                <VoicemailMarker
                  key={item.id}
                  event={e}
                  assistantName={aiName}
                  onJumpToReply={jumpToGuardianReply}
                />
              ) : (
                <CallMarker
                  key={item.id}
                  event={e}
                  actorName={actorFirstName(e.actor)}
                  assistantName={aiName}
                  onJumpToReply={jumpToGuardianReply}
                />
              )
            }
            const m = item.message
            const isOutbound = m.direction === 'outbound'
            // Who sent this message. Outbound: the user's first name, or the
            // assistant's name when sent_by is null (responder/AI auto-sends are
            // the only outbound path without a user — modern ones stamp the bot
            // user, so this mostly labels pre-July-2026 rows). Inbound in a GROUP: the
            // participant who texted — their contact name (from the group's
            // participant list, falling back to any contact match by id),
            // else their phone number, else "Unknown" — so "who said Blue?"
            // is never a mystery. 1:1 inbound stays unlabeled (it's obvious).
            let senderLabel: string | null = null
            if (isOutbound) {
              senderLabel =
                m.sender?.display_name?.trim().split(/\s+/)[0] || (!m.sent_by ? aiName : null)
            } else if (isGroup) {
              const gc = groupContacts.find((c) => c.id === m.contact_id)
              senderLabel = gc?.name?.trim() || (gc?.phone ? formatPhone(gc.phone) : 'Unknown')
            }
            // The line this message used, joined on the message itself so it's
            // stable across refetches and independent of the viewer's number
            // access. Null only on pre-launch messages (never stamped).
            const msgNumRow = Array.isArray(m.number) ? m.number[0] : m.number
            const msgNumberLabel = msgNumRow ? msgNumRow.label || msgNumRow.twilio_number : null
            return (
              <div
                key={item.id}
                className={`group flex items-center gap-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}
              >
                {isOutbound && m.body && (
                  <button
                    type="button"
                    onClick={() => openBoardPicker(m.body!)}
                    title="Add to a board"
                    aria-label="Add to a board"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-white/50 hover:text-white text-sm shrink-0 px-1"
                  >
                    ☑
                  </button>
                )}
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
                  {m.media_urls?.length > 0 && (() => {
                    // mu can be a raw storage_path (current format from
                    // /api/txt/upload + inbound webhook) or, rarely, an
                    // already-fully-qualified URL.
                    const toSrc = (mu: string) =>
                      /^https?:\/\//i.test(mu) ? mu : `/api/txt/media/${mu}`
                    // Build the lightbox set (images + PDFs, in order) and map
                    // each media index to its slide so a tap opens the right one.
                    // Videos play inline and aren't part of the lightbox.
                    const lbItems: LightboxItem[] = []
                    const lbIndex: Record<number, number> = {}
                    m.media_urls.forEach((mu, i) => {
                      const k = mediaKind(mu)
                      if (k === 'image' || k === 'pdf') {
                        lbIndex[i] = lbItems.length
                        lbItems.push({ type: k, src: toSrc(mu), filename: `attachment-${i + 1}`, downloadSrc: toSrc(mu) })
                      }
                    })
                    return (
                      <div className={`grid gap-1 ${m.body ? 'mt-2' : ''} ${
                        m.media_urls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                      }`}>
                        {m.media_urls.map((mu, i) => {
                          const k = mediaKind(mu)
                          const src = toSrc(mu)
                          if (k === 'image') {
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setLightbox({ items: lbItems, index: lbIndex[i] ?? 0 })}
                                className="block rounded-md overflow-hidden bg-black/20 p-0 border-0"
                                aria-label="Open image"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={src}
                                  alt="attachment"
                                  loading="lazy"
                                  className="w-full max-h-64 object-cover cursor-pointer"
                                />
                              </button>
                            )
                          }
                          if (k === 'video') {
                            return (
                              <video
                                key={i}
                                src={src}
                                controls
                                preload="metadata"
                                playsInline
                                className="w-full max-h-64 rounded-md bg-black"
                              />
                            )
                          }
                          if (k === 'pdf') {
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setLightbox({ items: lbItems, index: lbIndex[i] ?? 0 })}
                                className="text-xs underline text-white/80 hover:text-white text-left"
                              >
                                📄 attachment {i + 1}
                              </button>
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
                    )
                  })()}
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
                    {msgNumberLabel && (
                      <>
                        <span>·</span>
                        <span className={m.rerouted ? 'text-[var(--t-tint-warning)]' : ''}>
                          {isOutbound ? 'via ' : 'on '}{msgNumberLabel}
                        </span>
                      </>
                    )}
                  </div>
                  {m.error_message && isOutbound && (() => {
                    const fe = friendlyDeliveryError(m.error_message)
                    return (
                      <div
                        className={`text-[10px] mt-0.5 ${fe.hard ? 'text-[var(--t-tint-danger)]' : 'text-[var(--t-tint-warning)]'}`}
                        title={`Twilio: ${m.error_message}`}
                      >
                        {fe.label}
                      </div>
                    )
                  })()}
                  {m.rerouted && isOutbound && (
                    <div
                      className="text-[10px] mt-0.5 text-[var(--t-tint-warning)]"
                      title="Your main line was blocked for this customer, so this was sent from the toll-free line instead."
                    >
                      Rerouted to {msgNumberLabel || 'toll-free'} — main line blocked
                    </div>
                  )}
                </div>
                {!isOutbound && m.body && (
                  <button
                    type="button"
                    onClick={() => openBoardPicker(m.body!)}
                    title="Add to a board"
                    aria-label="Add to a board"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-white/50 hover:text-white text-sm shrink-0 px-1"
                  >
                    ☑
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {showNotes && (
          <div className="hidden md:flex flex-col w-72 border-l border-white/10 bg-[var(--t-panel-deep)] min-h-0">
            <div className="px-3 py-2 border-b border-white/10 text-xs text-[var(--t-tint-warning)]">
              Internal notes (not sent to customer)
            </div>
            {notesInner}
          </div>
        )}
      </div>

      {/* Composer — only when the user can actually send (owner / member, or an
          unclaimed Queue thread). Non-participants get the Join panel below. */}
      {!isArchived && canComposeHere && (
        <div className="border-t border-white/10 px-3 py-2 bg-[var(--t-panel-deep)]">
          {sendError && (
            <div className="text-xs text-[var(--t-tint-danger)] mb-1 px-1">{sendError}</div>
          )}
          {conversation.contact?.do_not_text && (
            <div className="text-xs text-[var(--t-tint-orange)] mb-1 px-1">
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
                  title={a.filename}
                >
                  {a.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.preview} alt={a.filename} className="w-16 h-16 object-cover" />
                  ) : a.kind === 'video' ? (
                    <video src={a.preview} muted playsInline className="w-16 h-16 object-cover bg-black" />
                  ) : (
                    <div className="w-16 h-16 flex flex-col items-center justify-center gap-0.5 px-1 text-center">
                      <span className="text-lg leading-none">{a.kind === 'pdf' ? '📄' : '📎'}</span>
                      <span className="w-full truncate text-[9px] text-white/70">{a.filename}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.storage_path)}
                    className="absolute top-0 right-0 w-5 h-5 bg-black/60 hover:bg-black/80 text-[#fff] text-xs leading-none rounded-bl-md"
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
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,video/mp4,video/quicktime,video/mpeg,video/3gpp"
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
              onPaste={handleComposerPaste}
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
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 p-2">
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
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 p-3 max-h-[60vh] overflow-y-auto">
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
                          className="text-white/40 hover:text-[var(--t-tint-danger)] flex-none text-sm leading-none"
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
              className="text-white/70 hover:text-white disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Attach an image (JPEG/PNG/GIF/WebP, up to 5 MB)"
              aria-label="Attach image"
            >
              <span className="text-base leading-none">📎</span>
            </button>
            <button
              type="button"
              onClick={openPickerManually}
              disabled={sending || !!conversation.contact?.do_not_text}
              className="text-white/70 hover:text-white disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-white/10"
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
                className="text-white/70 hover:text-white disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-white/10"
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
                  omwOpen ? 'text-[var(--t-tint-success)] bg-white/10' : 'text-white/70'
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
              className="text-white/70 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
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
                  scheduleOpen ? 'text-[var(--t-tint-warning)] bg-white/10' : 'text-white/50'
                }`}
                title="Schedule send"
                aria-label="Schedule send"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {scheduledList.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-amber-500 text-[9px] font-semibold text-[#fff] flex items-center justify-center">
                    {scheduledList.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex-1" />

            {/* ✨ AI help — ONE control for both writing and polishing. These
                used to be two separate ✨ buttons (Suggest lived up in the
                header, Polish here) rendering the SAME sparkle emoji, which
                made them indistinguishable. They're also mutually exclusive in
                practice: Suggest overwrites your draft so it's only wanted when
                the box is empty, and Polish is disabled when it is. So the one
                button reads the draft and offers whichever applies:
                  empty box  → write a reply (tone picker)
                  has a draft → polish it, with "write a new one" demoted
                When only ONE option is available (no Guardian tier ⇒ polish
                only) it skips the menu and just acts — a tech keeps today's
                exact one-tap Polish. ↩ Undo now sits BESIDE the button instead
                of replacing it, so you can still reopen the menu after a
                polish (previously a dead end until you edited the text). */}
            {polishUndo !== null && (
              <button
                type="button"
                onClick={undoPolish}
                className="text-[11px] text-white/60 hover:text-white px-1.5 py-1 rounded-md hover:bg-white/10"
                title="Undo polish — restore your original draft"
                aria-label="Undo polish"
              >
                ↩ Undo
              </button>
            )}
            {/* Rendered even when neither half applies, just DISABLED — the old
                Polish button was always present-but-disabled, so removing it
                entirely would hide the feature from anyone without Guardian
                until they typed, and shift the toolbar on their first
                keystroke. */}
            <div ref={aiRef} className="relative mr-0.5">
                <button
                  type="button"
                  onClick={() => {
                    // Close the sibling composer panels — none of them have an
                    // outside-click of their own, so without this the AI menu
                    // paints straight over an open On-my-way / Schedule panel.
                    setOmwOpen(false)
                    setScheduleOpen(false)
                    setEmojiOpen(false)
                    closePicker()
                    // Nothing to choose between → do the only thing available.
                    if (canPolishDraft && !canSuggestReply) {
                      runPolishDraft()
                      return
                    }
                    setAiOpen((v) => !v)
                  }}
                  disabled={aiBusy || (!canSuggestReply && !canPolishDraft)}
                  className={`transition-colors p-1.5 rounded-md disabled:opacity-40 ${
                    aiOpen
                      ? 'text-violet-200 bg-violet-500/20'
                      : 'text-violet-300/80 hover:text-violet-200 hover:bg-violet-500/15'
                  }`}
                  title={
                    !canSuggestReply && !canPolishDraft
                      ? 'AI help — type a draft to polish it'
                      : canPolishDraft && !canSuggestReply
                      ? 'Polish my draft — clean up grammar & tone'
                      : 'AI help — write or polish this reply'
                  }
                  aria-label="AI help"
                >
                  {aiBusy ? (
                    <span className="inline-block w-3.5 h-3.5 border-2 border-violet-300 border-t-transparent rounded-full animate-spin align-middle" />
                  ) : (
                    <span className="text-base leading-none">✨</span>
                  )}
                </button>
                {aiOpen && !aiBusy && (
                  <>
                    <div className="absolute right-0 bottom-full mb-2 w-56 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30">
                      {canPolishDraft ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setAiOpen(false)
                              runPolishDraft()
                            }}
                            className="block w-full text-left px-3 py-2 text-sm bg-violet-500/15 text-violet-100 hover:bg-violet-500/25"
                          >
                            ✨ Polish my draft
                          </button>
                          <div className="px-3 pb-1.5 pt-1 text-[10px] text-white/40">
                            Fix grammar &amp; tone, keep my meaning
                          </div>
                        </>
                      ) : (
                        <div className="px-3 py-2 text-[11px] text-white/40 border-b border-white/10">
                          Type a draft to polish it.
                        </div>
                      )}
                      {canSuggestReply && (
                        <>
                          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-white/40 border-t border-white/10">
                            {canPolishDraft ? 'Or write a new one' : 'Write a reply'}
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
                        </>
                      )}
                    </div>
                  </>
                )}
            </div>

            <span className="text-[10px] text-white/40 mr-1">
              {text.length > 0 && `${text.length}`}
              {selectedTemplateId && <span className="ml-1 text-[var(--t-tint-success)]">· tmpl</span>}
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
        <div className="border-t border-white/10 px-4 py-3 bg-[var(--t-panel-deep)] flex items-center justify-between gap-3">
          <span className="text-sm text-white/50">
            Unclaimed conversation. Claim it to reply.
          </span>
          <button
            type="button"
            onClick={() => assignTo(currentUserId)}
            className="flex-none text-sm px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff]"
          >
            Claim it
          </button>
        </div>
      )}

      {/* Join-to-reply — shown to a Txt2 user viewing a thread owned by someone
          else. Reading is open to everyone; sending isn't. One click adds them
          as a member and reveals the composer. */}
      {!isArchived && !canComposeHere && !isUnassigned && (
        <div className="border-t border-white/10 px-4 py-3 bg-[var(--t-panel-deep)] flex items-center justify-between gap-3">
          <span className="text-sm text-white/50">
            {conversation.assignee && conversation.assignee.id !== currentUserId
              ? `You're viewing ${conversation.assignee.display_name.split(' ')[0]}'s conversation. Join it to send a reply.`
              : "You're viewing this conversation. Join it to send a reply."}
          </span>
          <button
            type="button"
            onClick={joinConversation}
            disabled={joining}
            className="flex-none text-sm px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[#fff]"
          >
            {joining ? 'Joining…' : 'Join to reply'}
          </button>
        </div>
      )}

      {/* Archived footer — reopening is open to everyone (a rep needs to re-engage
          the customer). Reopen claims the thread + returns the composer in one tap. */}
      {isArchived && (
        <div className="border-t border-white/10 px-4 py-3 bg-amber-500/5 flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--t-tint-warning)]">
            This conversation is archived.
          </span>
          <button
            type="button"
            onClick={toggleArchive}
            className="flex-none text-sm px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-[#fff]"
          >
            Reopen to reply
          </button>
        </div>
      )}

      {/* Mobile notes overlay — the desktop rail is hidden on small screens, so
          on mobile the 📝 button opens this full-screen panel instead. */}
      {showNotes && (
        <div className="md:hidden fixed inset-0 z-50 bg-[var(--t-panel-deep)] flex flex-col">
          <div
            className="px-4 pb-3 border-b border-white/10 flex items-center justify-between"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
          >
            <span className="text-sm text-[var(--t-tint-warning)]">Internal notes (not sent to customer)</span>
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
            className="bg-[var(--t-panel)] border border-white/10 rounded-lg w-full max-w-xs max-h-[70vh] flex flex-col"
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
            setConversation({
              ...conversation,
              contact: { ...conversation.contact!, ...updated },
            })
            setEditContactOpen(false)
          }}
        />
      )}

      {addContactOpen && conversation.contact && (
        <ContactModal
          mode="create"
          initial={{
            name: contactNameIsPlaceholder ? '' : conversation.contact.name || '',
            phone: conversation.contact.phone || '',
          }}
          onClose={() => setAddContactOpen(false)}
          onCreated={(created) => {
            // POST adopts the existing stub by phone (same id → history kept)
            // and flips in_directory true; mirror that in local state.
            setConversation({
              ...conversation,
              contact: { ...conversation.contact!, ...created, in_directory: true },
            })
            setAddContactOpen(false)
          }}
        />
      )}

      {trackerOpen && !isGroup && conversation.contact && (
        <AddToTrackerModal
          sourceType="txt"
          sourceId={conversation.id}
          draftNoteConversationId={conversation.id}
          prefill={{
            name: conversation.contact.name,
            phone: conversation.contact.phone,
            email: conversation.contact.email ?? undefined,
          }}
          onClose={() => setTrackerOpen(false)}
          onLinked={(id) => {
            setTrackerLeadId(id)
            setTrackerOpen(false)
          }}
        />
      )}

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {boardPickerFor != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !addingToBoard && setBoardPickerFor(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-[var(--t-panel-deep)] border border-white/15 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/10 text-sm font-medium">
              Add to a board
            </div>
            <div className="px-4 py-2 text-xs text-white/60 border-b border-white/10 line-clamp-2">
              “{boardPickerFor}”
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {boardPickerBoards.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-white/50">
                  No boards yet. Create one in Hub → Boards first.
                </div>
              ) : (
                boardPickerBoards.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    disabled={addingToBoard}
                    onClick={() => addTextToBoard(b.id)}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
                  >
                    {b.name}
                  </button>
                ))
              )}
            </div>
            <div className="px-4 py-2 border-t border-white/10 text-right">
              <button
                type="button"
                disabled={addingToBoard}
                onClick={() => setBoardPickerFor(null)}
                className="text-xs text-white/60 hover:text-white px-2 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {boardAddedFor != null && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-full bg-emerald-600 text-[#fff] text-xs px-4 py-2 shadow-lg">
          ✓ Added to board
        </div>
      )}
    </div>
  )
}
