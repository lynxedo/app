// Shared Inbox — normalized domain types (provider-agnostic).
// The provider layer maps each transport's raw shapes (Nylas today) onto these,
// so the sync worker / API / UI never depend on Nylas-specific field names.

export type MailParticipant = { name?: string; email: string }

export type MailAttachment = {
  id: string
  filename?: string
  contentType?: string
  size?: number
  isInline?: boolean
}

export type MailDirection = 'inbound' | 'outbound'

export type MailThread = {
  providerThreadId: string
  subject: string | null
  snippet: string | null
  participants: MailParticipant[]
  lastMessageAt: string | null // ISO
  lastMessageDirection: MailDirection | null
  unread: boolean
  starred: boolean
  hasAttachments: boolean
  providerFolderIds: string[]
  messageIds: string[]
  latestMessageId: string | null
}

export type MailMessage = {
  providerMessageId: string
  providerThreadId: string | null
  subject: string | null
  from: MailParticipant | null
  to: MailParticipant[]
  cc: MailParticipant[]
  bcc: MailParticipant[]
  replyTo: MailParticipant[]
  date: string | null // ISO
  bodyHtml: string | null
  snippet: string | null
  direction: MailDirection
  unread: boolean
  hasAttachments: boolean
  attachments: MailAttachment[]
  providerFolderIds: string[]
}

export type MailFolder = {
  providerFolderId: string
  name: string
  parentProviderFolderId: string | null
  systemFolder: string | null // 'inbox' | 'sent' | 'archive' | 'trash' | 'drafts' | 'spam' | null
  unreadCount: number
  totalCount: number
}

export type ListThreadsOptions = {
  limit?: number
  pageToken?: string
  folderId?: string // Nylas `in`
  unread?: boolean
}

export type ListThreadsResult = {
  threads: MailThread[]
  nextCursor: string | null
}

export type SendMessageInput = {
  to: MailParticipant[]
  cc?: MailParticipant[]
  bcc?: MailParticipant[]
  subject: string
  bodyHtml: string
  replyToMessageId?: string
  trackReplies?: boolean
}

export type SendMessageResult = {
  providerMessageId: string
  providerThreadId: string | null
}

// Result of exchanging an OAuth code for a Nylas grant.
export type MailGrant = {
  grantId: string
  email: string
  underlyingProvider: string | null // 'microsoft' | 'google' | 'imap' | ...
}
