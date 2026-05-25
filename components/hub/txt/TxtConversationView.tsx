'use client'

import { useEffect, useRef, useState } from 'react'
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
}) {
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

  useEffect(() => {
    fetch('/api/txt/templates')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setTemplates(data.templates || []))
      .catch(() => setTemplates([]))
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
    if (!body || sending) return
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
      media_urls: [],
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

    const res = await fetch(`/api/txt/conversations/${conversation.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, template_id: templateIdForSend }),
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
                ? conversation.assignee.id === currentUserId
                  ? 'You'
                  : conversation.assignee.display_name.split(' ')[0]
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setAddMemberOpen((v) => !v)}
                className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-white/60"
                title="Add a teammate to this thread"
              >
                + member
              </button>
              {addMemberOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-[#0F2E47] border border-white/10 rounded-md shadow-lg z-30 max-h-60 overflow-y-auto">
                  {memberCandidates.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => addMember(u.id)}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                    >
                      {u.display_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
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

      {/* Body: messages + optional notes panel */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {messages.length === 0 && (
            <div className="text-center text-white/40 text-sm py-8">
              No messages yet.
            </div>
          )}
          {messages.map((m) => {
            const isOutbound = m.direction === 'outbound'
            return (
              <div
                key={m.id}
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
                    <div className="text-xs text-white/60 mt-1">
                      {m.media_urls.length} attachment(s)
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
              />
              <button
                onClick={addNote}
                disabled={!noteText.trim()}
                className="w-full px-2 py-1.5 rounded-md bg-amber-600/80 hover:bg-amber-600 text-xs disabled:opacity-50"
              >
                Save note
              </button>
            </div>
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
          <div className="flex gap-2 relative">
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
              disabled={sending || !text.trim() || !!conversation.contact?.do_not_text}
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
