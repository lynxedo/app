// Shared types + pure display helpers for the Hub Inbox (shared email) UI.
// Mirrors the small helpers used across the Txt UI (relative time, participant
// display name, initials). Date/currency/duration display live in @/lib/format;
// these are inbox-specific.

export type MailDirection = 'inbound' | 'outbound' | null
export type ThreadStatus = 'open' | 'assigned' | 'closed'
export type AccountType = 'shared' | 'personal'
export type Scope = 'mine' | 'all' | 'unassigned' | 'closed' | 'needs_reply'

/** An account row from GET /api/hub/email/accounts. */
export type InboxAccount = {
  id: string
  provider: string
  account_type: AccountType
  email_address: string
  display_name: string | null
  owner_user_id: string | null
  status: string | null
  active: boolean
}

/** Feature flags returned alongside the accounts list. */
export type AccountFlags = {
  isFullAccess: boolean
  canCompose: boolean
}

/** A thread row from GET /api/hub/email/threads. */
export type EmailThread = {
  id: string
  subject: string | null
  snippet: string | null
  from_name: string | null
  from_email: string | null
  last_message_at: string | null
  last_message_direction: MailDirection
  status: ThreadStatus
  assigned_to_user_id: string | null
  assignee_name: string | null
  is_shared: boolean
  unread: boolean
  has_attachments: boolean
  mine: boolean
  folder: string | null
}

/** A folder row from GET /api/hub/email/folders. */
export type MailFolder = {
  id: string
  provider_folder_id: string
  name: string
  system_folder: string | null
  unread_count: number
}

export type MailRecipient = { name?: string | null; email: string }

/** A message inside a thread (GET /api/hub/email/threads/{id}). */
export type EmailMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  from_name: string | null
  from_email: string | null
  to_recipients: MailRecipient[]
  subject: string | null
  body_html: string | null
  snippet: string | null
  message_date: string | null
  sent_by_user_id: string | null
  has_attachments: boolean
  attachments: Array<{ id: string; filename: string; content_type: string; size: number }>
}

export type ThreadMember = {
  user_id: string
  role: 'owner' | 'member'
  display_name: string | null
}

export type ThreadNote = {
  id: string
  body: string
  created_by: string
  created_by_name: string | null
  created_at: string
}

export type ThreadPermissions = {
  canReply: boolean
  canAssign: boolean
  canClaim: boolean
  canClose: boolean
  canShare: boolean
  canNote: boolean
  isFullAccess: boolean
}

export type ThreadDetail = {
  thread: EmailThread
  messages: EmailMessage[]
  members: ThreadMember[]
  notes: ThreadNote[]
  permissions: ThreadPermissions
}

/** "now" / "5m" / "3h" / "today" / "Jul 20" — matches the Txt sidebar. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (d.toDateString() === now.toDateString()) return 'today'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Longer form for message headers: "Jul 20, 3:15 PM" (today → just the time). */
export function messageTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (d.toDateString() === new Date().toDateString()) return time
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + time
}

/** How long a thread has waited (for the oversight aging list): "2h" / "3d". */
export function waitedFor(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

/** Display name for the customer on a thread: from_name, else the email. */
export function participantName(from_name: string | null, from_email: string | null): string {
  return (from_name && from_name.trim()) || (from_email && from_email.trim()) || 'Unknown sender'
}

/** Up-to-2-letter initials for an avatar chip. */
export function initials(name: string | null | undefined): string {
  const n = (name || '').trim()
  if (!n) return '?'
  if (n.includes('@')) return n[0].toUpperCase()
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** First name only (chips, "Owner: X"). */
export function firstName(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/)[0] || ''
}

/** Turn a plain-text reply into minimal, safe HTML (escape + <br>). */
export function plainToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(/\r?\n/g, '<br>')
}

/** Parse a comma/semicolon/space separated recipient string into {email} rows. */
export function parseRecipients(raw: string): MailRecipient[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => ({ email }))
}

/** Human file size for an attachment chip. */
export function fileSize(bytes: number | null | undefined): string {
  const b = bytes || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
