'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ContactModal, { type ContactForModal } from './ContactModal'
import TemplatePicker, { filterTemplates, type PickerTemplate } from './TemplatePicker'

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
  canAssign,
  canAccessDialer,
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
  canAssign: boolean
  canAccessDialer: boolean
  hasGuardian?: boolean
}) {
  const router = useRouter()
  const [conversation, setConversation] = useState(initialConversation)
  const [messages, setMessages] = useState(initialMessages)
  const [notes, setNotes] = useState(initialNotes)
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const groupContacts = initialGroupContacts
    .map((row) => unwrap(row.contact))
    .filter((c): c is Contact => Boolean(c))
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
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
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
  const canReplyHere = isOwnerMe || isMemberMe || canAssign

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

  useEffect(() => {
    fetch('/api/txt/templates')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setTemplates(data.templates || []))
      .catch(() => setTemplates([]))
    fetch('/api/txt/numbers')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setNumbers(data.numbers || []))
      .catch(() => setNumbers([]))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Poll for new messages every 8s (realtime channel can be added later)
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch(`/api/txt/conversations/${conversation.id}`)
      if (!res.ok) return
      const data = await res.json()
      setConversation(data.conversation)
      setMessages(data.messages || [])
      setNotes(data.notes || [])
      setMembers(data.members || [])
    }, 8000)
    return () => clearInterval(t)
  }, [conversation.id])

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
      sender: null,
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

  // Interleave internal notes into the message stream as small markers, in
  // chronological order, so staff can see where in the conversation a note was
  // taken. Tapping a marker opens the notes panel.
  const timeline: Array<
    | { kind: 'message'; id: string; at: string; message: Message }
    | { kind: 'note'; id: string; at: string; note: Note }
  > = [
    ...messages.map((m) => ({ kind: 'message' as const, id: `m-${m.id}`, at: m.created_at, message: m })),
    ...notes.map((n) => ({ kind: 'note' as const, id: `n-${n.id}`, at: n.created_at, note: n })),
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
        <div className="flex items-center gap-2 flex-none">
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
          {numbers.length >= 2 && (isOwnerMe || isMemberMe || canAssign) && (
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
          <button
            onClick={toggleArchive}
            className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20"
            title={isArchived ? 'Reopen' : 'Archive'}
          >
            {isArchived ? '↺' : '✓'}
          </button>
        </div>
      </div>

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
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {messages.length === 0 && (
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
            const m = item.message
            const isOutbound = m.direction === 'outbound'
            return (
              <div
                key={item.id}
                className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${
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
          <div ref={bottomRef} />
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

      {/* Composer */}
      {!isArchived && (
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
          <div className="flex gap-2 relative">
            <button
              type="button"
              onClick={pickAttachments}
              disabled={sending || uploadingAttachment || !!conversation.contact?.do_not_text}
              className="self-start mt-1 px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm disabled:opacity-50"
              title="Attach an image (JPEG/PNG/GIF/WebP, up to 5 MB)"
              aria-label="Attach image"
            >
              📎
            </button>
            <button
              type="button"
              onClick={openPickerManually}
              disabled={sending || !!conversation.contact?.do_not_text}
              className="self-start mt-1 px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm disabled:opacity-50"
              title="Insert template (or type / in the composer)"
              aria-label="Insert template"
            >
              📋
            </button>
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
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm resize-none"
              style={{ minHeight: 36, maxHeight: 120, fontSize: 16 }}
              disabled={sending || !!conversation.contact?.do_not_text}
            />
            <button
              onClick={sendMessage}
              disabled={
                sending ||
                (!text.trim() && pendingAttachments.length === 0) ||
                !!conversation.contact?.do_not_text
              }
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? '…' : 'Send'}
            </button>
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
          </div>
          <div className="flex items-center justify-between mt-1 px-1 text-[10px] text-white/40">
            <span>
              {text.length > 0 && `${text.length} char${text.length === 1 ? '' : 's'}`}
              {selectedTemplateId && (
                <span className="ml-2 text-emerald-300">· template applied</span>
              )}
            </span>
            <span>Mobile: tap Send. Desktop: Enter to send.</span>
          </div>
        </div>
      )}

      {isArchived && (
        <div className="border-t border-white/10 px-4 py-3 bg-amber-500/5 text-amber-200 text-sm text-center">
          This conversation is archived. Tap ↺ above to reopen.
        </div>
      )}

      {/* Mobile notes overlay — the desktop rail is hidden on small screens, so
          on mobile the 📝 button opens this full-screen panel instead. */}
      {showNotes && (
        <div className="md:hidden fixed inset-0 z-50 bg-[#0B2237] flex flex-col">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
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
