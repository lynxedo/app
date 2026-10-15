// Shared types + pure display helpers for the Hub Inbox (shared email) UI.
// Mirrors the small helpers used across the Txt UI (relative time, participant
// display name, initials). Date/currency/duration display live in @/lib/format;
// these are inbox-specific.

import type { CSSProperties } from 'react'

export type MailDirection = 'inbound' | 'outbound' | null
export type ThreadStatus = 'open' | 'assigned' | 'closed'
export type AccountType = 'shared' | 'personal'
// Primary tab scope. 'unassigned' backs the manager Queue fetch (not a tab).
export type Scope = 'mine' | 'all' | 'unassigned' | 'closed'
// Secondary within-list lens (Txt-style): All · Unread · Needs replied.
export type Lens = 'all' | 'unread' | 'needs_reply'
// Waiting-on workflow state — orthogonal to status (a thread can be assigned AND waiting).
export type WaitingState = 'customer' | 'tech' | 'vendor' | 'approval'
export const WAITING_LABELS: Record<WaitingState, string> = {
  customer: 'Waiting on customer',
  tech: 'Waiting on tech',
  vendor: 'Waiting on vendor',
  approval: 'Waiting on approval',
}

/** An admin-managed tag definition (GET /api/hub/email/tags). 'type' = what it IS,
 *  'outcome' = what happened / what's next. Resolve a thread's tag ids against this list. */
export type InboxTag = {
  id: string
  kind: 'type' | 'outcome'
  name: string
  color: string
  sort_order: number
  active: boolean
}

/** A company-shared canned response / template (GET /api/hub/email/templates). */
export type InboxTemplate = {
  id: string
  name: string
  subject: string | null
  body_html: string
  sort_order: number
  active: boolean
}

/** A per-user saved list view (GET /api/hub/email/saved-views). config = the list filters. */
export type InboxSavedView = {
  id: string
  name: string
  config: {
    scope?: string
    tag?: string
    waiting?: string
    folder?: string
    search?: string
    snoozed?: boolean
  }
  sort_order: number
}

/**
 * The Hub theme remaps the entire Tailwind --color-* palette per theme, so
 * bg-white / bg-gray-* / text-gray-* render DARK under a dark/inverted theme.
 * The email MAIN pane must always be a real light "email client" surface, so we
 * re-declare the palette to true light values on each main-pane root. Applied
 * INLINE (not via a CSS class) because Tailwind's build purges a bare custom
 * class rule — inline styles can't be purged and always win. Cast to
 * React.CSSProperties at the call site (custom-property keys). Sidebar/list are
 * intentionally NOT given this — they keep the user's chosen theme.
 */
export const LIGHT_SURFACE_STYLE = {
  colorScheme: 'light',
  '--color-white': '#fff',
  '--color-gray-50': '#f9fafb',
  '--color-gray-100': '#f3f4f6',
  '--color-gray-200': '#e5e7eb',
  '--color-gray-300': '#d1d5db',
  '--color-gray-400': '#9ca3af',
  '--color-gray-500': '#6b7280',
  '--color-gray-600': '#4b5563',
  '--color-gray-700': '#374151',
  '--color-gray-800': '#1f2937',
  '--color-gray-900': '#111827',
  '--color-gray-950': '#030712',
} as CSSProperties

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
  isManager: boolean // sees All + the unassigned Queue; can claim/assign/close/share
  hasAccess: boolean // may enter the shared inbox (Standard user sees only their threads)
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
  /** The connected mailbox this thread lives on. Returned by GET /threads/{id};
   *  used to default the "forward from" mailbox. Optional on list responses. */
  account_id?: string | null
  /** Optional — number of messages in the thread (used for the expand chevron).
   *  Older API responses may omit it; treat missing as "unknown, maybe multi". */
  message_count?: number | null
  /** Phase 2 — applied tag ids (resolve to name/color via the loaded tag catalog). */
  tags?: string[] | null
  /** Phase 2 — "waiting on …" workflow state (null = not waiting). */
  waiting_state?: WaitingState | null
  /** Phase 2 — when the waiting state was set (detail responses). */
  waiting_set_at?: string | null
  /** Phase 3A — snoozed until (hidden from active views until this time passes). */
  snoozed_until?: string | null
  /** Phase 3A — follow-up reminder time + optional note. */
  follow_up_at?: string | null
  follow_up_note?: string | null
}

/** A draft row from GET /api/hub/email/drafts. */
export type EmailDraft = {
  id: string
  account_id: string
  thread_id: string | null
  kind: string // 'new' | 'reply' | 'reply-all' | 'forward'
  to_recipients: MailRecipient[]
  cc_recipients: MailRecipient[]
  bcc_recipients: MailRecipient[]
  subject: string | null
  body_html: string | null
  attachments: OutgoingAttachment[]
  scheduled_at: string | null
  status: string
  updated_at: string
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
  isInline?: boolean | null
  /** The MIME Content-ID a body's `<img src="cid:…">` points at (synced since Oct 2026). */
  contentId?: string | null
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
  /** Cc recipients on the message (returned by GET /threads/{id}). Used to seed
   *  Reply-All + to render the quoted-message header. */
  cc_recipients?: MailRecipient[] | null
  subject: string | null
  body_html: string | null
  body_text?: string | null
  snippet: string | null
  message_date: string | null
  sent_by_user_id: string | null
  /** The teammate who sent it from Hub (resolved by GET /threads/{id}). */
  sent_by_name?: string | null
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

/** The directory contact a thread is with, when one could be resolved. Drives
 *  the "Customer file" link on the thread header. */
export type ThreadCustomer = {
  contactId: string
  name: string | null
  email: string | null
}

export type ThreadDetail = {
  thread: EmailThread
  messages: EmailMessage[]
  members: ThreadMember[]
  notes: ThreadNote[]
  permissions: ThreadPermissions
  /** Null for the vendor/newsletter traffic that isn't about a customer. */
  customer?: ThreadCustomer | null
  /** The caller's in-progress reply draft for this thread, if any (resume support). */
  myDraft?: EmailDraft | null
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

/** Day-divider label in a conversation: "Today" / "Yesterday" / "Monday, October 12" (+ year when not this year). */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

/** Full timestamp on an open message: "Wed, Oct 14, 7:51 AM" (+ year when not this year). */
export function fullMessageTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  })
}

/** "just now" / "5 minutes ago" / "3 hours ago" / "2 days ago" — beside a full timestamp. */
export function agoLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000))
  if (mins < 1) return 'just now'
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  if (mins < 60) return plural(mins, 'minute')
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return plural(hrs, 'hour')
  const days = Math.floor(hrs / 24)
  if (days < 30) return plural(days, 'day')
  return ''
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

// ── Reply / Reply-All / Forward composer helpers ────────────────────────────

/** "Name <email>" (or just whichever half is present) — the composer's To/From
 *  display lines and the outbound quote header. */
export function formatWho(name: string | null | undefined, email: string | null | undefined): string {
  const n = (name || '').trim()
  const e = (email || '').trim()
  if (n && e) return `${n} <${e}>`
  return n || e || 'Unknown sender'
}

/** Comma-joined "email" list (bare addresses only — parseRecipients() takes each
 *  comma-separated token as a literal address, so names aren't embedded here).
 *  Used for the quote header's "To:" line and to prefill editable Cc inputs. */
export function formatRecipientList(list: MailRecipient[] | null | undefined): string {
  return (list || [])
    .map((r) => (r.email || '').trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * Outlook-style "From / Date / To / Subject" quote header (HTML block) for the
 * reply/reply-all/forward outbound body. Plain known fields rendered as escaped
 * HTML text — safe to concatenate directly into bodyHtml (unlike the quoted
 * message's own body, which must stay inside the sandboxed iframe / go out
 * verbatim, never through this escaping path).
 */
export function buildForwardQuoteHeaderHtml(message: {
  from_name: string | null
  from_email: string | null
  message_date: string | null
  to_recipients: MailRecipient[] | null | undefined
  subject: string | null
}): string {
  const to = formatRecipientList(message.to_recipients)
  const lines = [
    `From: ${formatWho(message.from_name, message.from_email)}`,
    `Date: ${messageTime(message.message_date) || 'Unknown'}`,
    ...(to ? [`To: ${to}`] : []),
    `Subject: ${message.subject || '(no subject)'}`,
  ]
  const rows = lines.map((l) => `<div>${plainToHtml(l)}</div>`).join('')
  return `<div style="color:#6b7280;font-size:12px;line-height:1.6;margin:16px 0 4px;">${rows}</div>`
}

/** "Fwd:"-normalize a subject for the forward composer (avoids double "Fwd:").
 *  Display + outbound — the compose route sends the subject verbatim. */
export function fwdSubject(subject: string | null | undefined): string {
  const base = (subject || '').trim()
  if (/^fwd\s*:/i.test(base)) return base
  return base ? `Fwd: ${base}` : 'Fwd:'
}

/** Display-only "Re:"-normalize for the reply/reply-all composer's read-only
 *  subject line (the real outgoing subject is always computed server-side in
 *  sendInboxReply, which doesn't take a subject param — this is label text only). */
export function reSubjectDisplay(subject: string | null | undefined): string {
  const base = (subject || '').trim()
  if (/^re\s*:/i.test(base)) return base
  return base ? `Re: ${base}` : 'Re:'
}

// ─── Reading-pane preparation of an email body ──────────────────────────────

/** Where a quoted earlier message starts, per mail client. The first match (in
 *  document order) and everything after it is the "trimmed content" a reader
 *  hides behind •••, the way Gmail does. `.lynxedo_quote` is our own composer's. */
const QUOTE_START_SELECTORS = [
  '.lynxedo_quote',
  '#appendonsend', // Outlook desktop (empty marker right before the quote)
  '#divRplyFwdMsg', // Outlook web / new Outlook
  '#mail-editor-reference-message-container', // Outlook for iOS/Android
  '.gmail_quote',
  '.gmail_extra',
  '.yahoo_quoted',
  '.moz-cite-prefix', // Thunderbird
  'blockquote[type="cite"]', // Apple Mail
  // Outlook desktop's "From: … Sent: …" header block.
  'div[style*="border-top:solid #E1E1E1" i]',
  'div[style*="border-top: solid #E1E1E1" i]',
  'div[style*="border-top:solid #B5C4DF" i]',
].join(',')

export type PreparedEmailHtml = {
  /** The whole message, ready for the sandboxed frame. */
  full: string
  /** The message without its quoted history, or null when there is none to hide. */
  trimmed: string | null
  /** Attachment ids now shown inside the body (pasted pictures, logos) — not repeated as chips. */
  embeddedAttachmentIds: string[]
}

function attachmentUrl(messageId: string, attachmentId: string): string {
  return `/api/hub/email/attachments/${messageId}/${encodeURIComponent(attachmentId)}`
}

function stripAngle(s: string): string {
  return s.trim().replace(/^</, '').replace(/>$/, '').toLowerCase()
}

/**
 * Make a stored email body readable in the reading pane:
 *  - every link opens in a NEW browser tab (`<base target="_blank">`) — without
 *    it, a link with no target tried to load the site inside the email frame,
 *    which most sites refuse, so the click did nothing;
 *  - pictures pasted into the email (`<img src="cid:…">`) point at our attachment
 *    download route, so they show instead of a broken image;
 *  - the quoted earlier messages are split off so the reader can hide them.
 *
 * Parsing uses DOMParser, whose documents are inert (no script runs, nothing
 * loads), and the result still renders only inside the scripts-off sandbox.
 */
export function prepareEmailHtml(
  html: string,
  messageId: string,
  attachments: MessageAttachment[] | null | undefined
): PreparedEmailHtml {
  const BASE = '<base target="_blank">'
  if (typeof DOMParser === 'undefined') {
    return { full: BASE + html, trimmed: null, embeddedAttachmentIds: [] }
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const base = doc.createElement('base')
  base.setAttribute('target', '_blank')
  doc.head.prepend(base)

  // cid: pictures → attachment URLs. Match on the Content-ID when it was synced,
  // else on the filename Outlook bakes into the cid ("image001.jpg@01DD…"), else
  // take the next unused picture attachment in order (older rows carry no
  // Content-ID; senders put inline pictures in body order).
  const atts = (attachments || []).filter((a) => a && a.id && !a.id.includes('/'))
  const isImage = (a: MessageAttachment) => /^image\//i.test(a.contentType || a.content_type || '')
  const used = new Set<string>()
  const pick = (cid: string): MessageAttachment | undefined => {
    const c = stripAngle(cid)
    const free = atts.filter((a) => !used.has(a.id))
    return (
      free.find((a) => a.contentId && stripAngle(a.contentId) === c) ||
      free.find((a) => {
        const f = (a.filename || '').toLowerCase()
        return !!f && (c === f || c.startsWith(f + '@'))
      }) ||
      free.find((a) => isImage(a) && a.isInline && !a.contentId)
    )
  }
  const embedded: string[] = []
  doc.querySelectorAll('img[src^="cid:" i]').forEach((img) => {
    const src = img.getAttribute('src') || ''
    const att = pick(src.slice(4))
    if (!att) return
    used.add(att.id)
    // A sent-as-attachment photo the body also shows keeps its chip; only true
    // inline pieces (signature logos, pasted pictures) drop out of the chip row.
    if (att.isInline) embedded.push(att.id)
    img.setAttribute('src', attachmentUrl(messageId, att.id))
  })

  const serialize = () => '<!doctype html>' + doc.documentElement.outerHTML
  const full = serialize()

  let trimmed: string | null = null
  const start = doc.body.querySelector(QUOTE_START_SELECTORS)
  if (start) {
    const prev = start.previousElementSibling
    if (prev && prev.tagName === 'HR') prev.remove() // Outlook web's separator line
    let cur: Node = start
    while (cur !== doc.body && cur.parentNode) {
      const parent: Node = cur.parentNode
      while (cur.nextSibling) parent.removeChild(cur.nextSibling)
      cur = parent
    }
    start.remove()
    // Only hide history when something of the new message is left to read.
    const leftover = (doc.body.textContent || '').trim().length > 0 || !!doc.body.querySelector('img')
    if (leftover) trimmed = serialize()
  }

  return { full, trimmed, embeddedAttachmentIds: embedded }
}
