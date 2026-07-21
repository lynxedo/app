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
  /** Optional — number of messages in the thread (used for the expand chevron).
   *  Older API responses may omit it; treat missing as "unknown, maybe multi". */
  message_count?: number | null
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

/** Attachment metadata as stored on inbox_messages.attachments (jsonb). Key
 *  spelling can be snake_case (older rows) or camelCase (attachments API) —
 *  normalize through attachmentMeta() before rendering. */
export type MessageAttachment = {
  id: string
  filename?: string | null
  content_type?: string | null
  contentType?: string | null
  size?: number | null
}

/** Normalize either attachment key spelling into one display shape. */
export function attachmentMeta(a: MessageAttachment): {
  id: string
  filename: string
  contentType: string
  size: number
} {
  return {
    id: a.id,
    filename: (a.filename || '').trim() || 'attachment',
    contentType: a.contentType || a.content_type || '',
    size: typeof a.size === 'number' ? a.size : 0,
  }
}

/** An attachment staged for an outgoing send (POST /api/hub/email/attachments). */
export type OutgoingAttachment = {
  id: string
  filename: string
  contentType: string
  size: number
}

/** A message inside a thread (GET /api/hub/email/threads/{id}). */
export type EmailMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  from_name: string | null
  from_email: string | null
  to_recipients: MailRecipient[]
  subject: string | null
  body_html: string | null
  body_text?: string | null
  snippet: string | null
  message_date: string | null
  sent_by_user_id: string | null
  has_attachments: boolean
  attachments: MessageAttachment[]
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

// ── Rich composer helpers ────────────────────────────────────────────────────

/** Multi-paragraph plain text → simple HTML (blank line = new <p>). */
export function textToHtmlParagraphs(text: string): string {
  const blocks = (text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  const html = blocks
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `<p>${plainToHtml(b)}</p>`)
    .join('')
  return html || '<p></p>'
}

/** A stored signature may be legacy plain text or HTML (new settings editor). */
export function signatureToHtml(sig: string | null | undefined): string {
  const s = (sig || '').trim()
  if (!s) return ''
  if (/<[a-z][^>]*>/i.test(s)) return s
  return `<p>${plainToHtml(s)}</p>`
}

/** Rough HTML → plain text (keeps line breaks; used for draft extraction). */
export function htmlToPlainText(html: string): string {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The "On {date}, {who} wrote:" line above a quoted reply. */
export function buildQuoteHeader(
  name: string | null | undefined,
  email: string | null | undefined,
  dateIso: string | null | undefined
): string {
  const d = dateIso ? new Date(dateIso) : null
  const when =
    d && !isNaN(d.getTime())
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' at ' +
        d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      : ''
  const who = (name || '').trim()
  const addr = (email || '').trim()
  const whoPart = who && addr ? `${who} <${addr}>` : who || addr || 'they'
  return when ? `On ${when}, ${whoPart} wrote:` : `${whoPart} wrote:`
}

/** Matches the quote-header line in the editor's PLAIN TEXT (getText). */
const QUOTE_HEADER_TEXT_RE = /(^|\n)On [^\n]{0,300} wrote:/

/**
 * The user's actual draft = editor text minus the quoted tail and minus their
 * pre-loaded signature. Whitespace-normalized (used for send gating + the AI
 * Suggest/Polish plumbing, not for the outgoing HTML).
 */
export function extractDraftText(fullText: string, signatureText: string): string {
  let top = fullText || ''
  const idx = top.search(QUOTE_HEADER_TEXT_RE)
  if (idx >= 0) top = top.slice(0, idx)
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const nt = norm(top)
  const ns = norm(signatureText || '')
  if (ns && nt.endsWith(ns)) return nt.slice(0, nt.length - ns.length).trim()
  return nt
}

/**
 * Everything from the quote-header paragraph onward in the editor's HTML —
 * used to preserve the quoted section when AI Suggest/Polish rebuilds the top.
 */
export function extractQuotedTailHtml(html: string): string {
  const m = (html || '').match(/<p[^>]*>On [\s\S]{0,400}? wrote:<\/p>\s*<blockquote[\s\S]*$/)
  return m ? m[0] : ''
}

/**
 * Final outgoing HTML: inline-style the blockquotes (recipients' mail clients
 * don't get our editor CSS), keep empty paragraphs visible, and wrap in a
 * sane default font stack.
 */
export function finalizeEmailHtml(html: string): string {
  const styled = (html || '')
    .replace(
      /<blockquote>/g,
      '<blockquote style="border-left:3px solid #d1d5db;margin:8px 0 8px 4px;padding-left:12px;color:#6b7280;">'
    )
    .replace(/<p><\/p>/g, '<p><br></p>')
  return `<div style="font-family:Arial, Helvetica, sans-serif;font-size:14px;line-height:1.5;color:#111827;">${styled}</div>`
}
