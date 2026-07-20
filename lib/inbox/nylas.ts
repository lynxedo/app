// Nylas v3 implementation of the MailProvider interface + hosted-OAuth helpers.
// Docs: https://developer.nylas.com/docs/api/v3/ecc/
// All Data-API calls authenticate with the app-level API key (Bearer); the grant id selects the mailbox.

import { nylasApiKey, nylasApiUri, nylasClientId, nylasRedirectUri } from './config'
import type {
  ListThreadsOptions,
  ListThreadsResult,
  MailFolder,
  MailGrant,
  MailMessage,
  MailParticipant,
  MailThread,
  SendMessageInput,
  SendMessageResult,
} from './types'
import type { MailProvider } from './provider'

// ---------- raw Nylas shapes (only the fields we use) ----------
type NylasEmailName = { name?: string; email: string }
type NylasThread = {
  id: string
  subject?: string | null
  snippet?: string | null
  participants?: NylasEmailName[]
  unread?: boolean
  starred?: boolean
  has_attachments?: boolean
  folders?: string[]
  message_ids?: string[]
  latest_message_received_date?: number | null
  latest_message_sent_date?: number | null
  earliest_message_date?: number | null
}
type NylasMessage = {
  id: string
  thread_id?: string | null
  subject?: string | null
  from?: NylasEmailName[]
  to?: NylasEmailName[]
  cc?: NylasEmailName[]
  bcc?: NylasEmailName[]
  reply_to?: NylasEmailName[]
  date?: number | null
  body?: string | null
  snippet?: string | null
  unread?: boolean
  starred?: boolean
  folders?: string[]
  attachments?: Array<{ id: string; filename?: string; content_type?: string; size?: number; is_inline?: boolean }>
}
type NylasFolder = {
  id: string
  name?: string
  parent_id?: string | null
  system_folder?: boolean
  attributes?: string[]
  total_count?: number
  unread_count?: number
}

const TIMEOUT_MS = 20000

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${nylasApiKey() || ''}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

async function nylasFetch<T>(path: string, init?: RequestInit): Promise<{ data: T; nextCursor: string | null }> {
  if (!nylasApiKey()) throw new Error('Nylas not configured (NYLAS_API_KEY missing)')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${nylasApiUri()}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers || {}) },
      signal: controller.signal,
      cache: 'no-store',
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const msg =
        (json as { error?: { message?: string }; message?: string } | null)?.error?.message ||
        (json as { message?: string } | null)?.message ||
        text ||
        `Nylas ${res.status}`
      throw new Error(`Nylas ${res.status}: ${msg}`)
    }
    const body = (json || {}) as { data?: T; next_cursor?: string | null }
    return { data: body.data as T, nextCursor: body.next_cursor ?? null }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- mappers ----------
function toParticipant(e?: NylasEmailName | null): MailParticipant | null {
  if (!e || !e.email) return null
  return { name: e.name || undefined, email: e.email }
}
function toParticipants(list?: NylasEmailName[] | null): MailParticipant[] {
  return (list || []).filter((e) => e && e.email).map((e) => ({ name: e.name || undefined, email: e.email }))
}
function isoFromUnix(sec?: number | null): string | null {
  if (!sec && sec !== 0) return null
  if (!sec) return null
  return new Date(sec * 1000).toISOString()
}

function mapThread(t: NylasThread): MailThread {
  const received = t.latest_message_received_date ?? null
  const sent = t.latest_message_sent_date ?? null
  const last = Math.max(received || 0, sent || 0) || t.earliest_message_date || null
  // If the most recent activity was a received message, the customer wrote last => inbound.
  let direction: 'inbound' | 'outbound' | null = null
  if ((received || 0) || (sent || 0)) direction = (received || 0) >= (sent || 0) ? 'inbound' : 'outbound'
  const messageIds = t.message_ids || []
  return {
    providerThreadId: t.id,
    subject: t.subject ?? null,
    snippet: t.snippet ?? null,
    participants: toParticipants(t.participants),
    lastMessageAt: isoFromUnix(last),
    lastMessageDirection: direction,
    unread: !!t.unread,
    starred: !!t.starred,
    hasAttachments: !!t.has_attachments,
    providerFolderIds: t.folders || [],
    messageIds,
    latestMessageId: messageIds.length ? messageIds[messageIds.length - 1] : null,
  }
}

function mapMessage(m: NylasMessage, selfEmails: Set<string>): MailMessage {
  const from = toParticipant(m.from?.[0])
  // Outbound iff the sender is one of this mailbox's addresses.
  const direction: 'inbound' | 'outbound' =
    from && selfEmails.has(from.email.toLowerCase()) ? 'outbound' : 'inbound'
  return {
    providerMessageId: m.id,
    providerThreadId: m.thread_id ?? null,
    subject: m.subject ?? null,
    from,
    to: toParticipants(m.to),
    cc: toParticipants(m.cc),
    bcc: toParticipants(m.bcc),
    replyTo: toParticipants(m.reply_to),
    date: isoFromUnix(m.date),
    bodyHtml: m.body ?? null,
    snippet: m.snippet ?? null,
    direction,
    unread: !!m.unread,
    hasAttachments: (m.attachments?.length || 0) > 0,
    attachments: (m.attachments || []).map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.content_type,
      size: a.size,
      isInline: a.is_inline,
    })),
    providerFolderIds: m.folders || [],
  }
}

function mapFolder(f: NylasFolder): MailFolder {
  const attrs = (f.attributes || []).map((a) => a.toLowerCase())
  const nameLc = (f.name || '').toLowerCase()
  let system: string | null = null
  const has = (k: string) => attrs.some((a) => a.includes(k)) || nameLc === k
  if (has('inbox')) system = 'inbox'
  else if (has('sent')) system = 'sent'
  else if (has('drafts') || has('draft')) system = 'drafts'
  else if (has('archive') || has('all')) system = 'archive'
  else if (has('trash') || has('deleted')) system = 'trash'
  else if (has('spam') || has('junk')) system = 'spam'
  return {
    providerFolderId: f.id,
    name: f.name || '(unnamed)',
    parentProviderFolderId: f.parent_id ?? null,
    systemFolder: system,
    unreadCount: f.unread_count || 0,
    totalCount: f.total_count || 0,
  }
}

// ---------- provider ----------
export class NylasProvider implements MailProvider {
  readonly name = 'nylas'
  private grantId: string
  private selfEmails: Set<string>

  constructor(grantId: string, selfEmail?: string | null) {
    this.grantId = grantId
    this.selfEmails = new Set((selfEmail ? [selfEmail] : []).map((e) => e.toLowerCase()))
  }

  private g(path: string) {
    return `/v3/grants/${encodeURIComponent(this.grantId)}${path}`
  }

  async listThreads(opts: ListThreadsOptions = {}): Promise<ListThreadsResult> {
    const q = new URLSearchParams()
    q.set('limit', String(opts.limit ?? 50))
    if (opts.pageToken) q.set('page_token', opts.pageToken)
    if (opts.folderId) q.set('in', opts.folderId)
    if (typeof opts.unread === 'boolean') q.set('unread', String(opts.unread))
    const { data, nextCursor } = await nylasFetch<NylasThread[]>(this.g(`/threads?${q.toString()}`))
    return { threads: (data || []).map(mapThread), nextCursor }
  }

  async getThread(threadId: string): Promise<MailThread> {
    const { data } = await nylasFetch<NylasThread>(this.g(`/threads/${encodeURIComponent(threadId)}`))
    return mapThread(data)
  }

  async listMessages(threadId: string): Promise<MailMessage[]> {
    const q = new URLSearchParams({ thread_id: threadId, limit: '100' })
    const { data } = await nylasFetch<NylasMessage[]>(this.g(`/messages?${q.toString()}`))
    return (data || []).map((m) => mapMessage(m, this.selfEmails))
  }

  async getMessage(messageId: string): Promise<MailMessage> {
    const { data } = await nylasFetch<NylasMessage>(this.g(`/messages/${encodeURIComponent(messageId)}`))
    return mapMessage(data, this.selfEmails)
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const body = {
      to: input.to.map((p) => ({ name: p.name, email: p.email })),
      cc: (input.cc || []).map((p) => ({ name: p.name, email: p.email })),
      bcc: (input.bcc || []).map((p) => ({ name: p.name, email: p.email })),
      subject: input.subject,
      body: input.bodyHtml,
      ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
      tracking_options: { opens: false, thread_replies: !!input.trackReplies, links: false, label: '' },
    }
    const { data } = await nylasFetch<{ id: string; thread_id?: string | null }>(this.g('/messages/send'), {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { providerMessageId: data.id, providerThreadId: data.thread_id ?? null }
  }

  async listFolders(): Promise<MailFolder[]> {
    const { data } = await nylasFetch<NylasFolder[]>(this.g('/folders?limit=200'))
    return (data || []).map(mapFolder)
  }

  async moveMessageToFolder(messageId: string, folderId: string): Promise<void> {
    await nylasFetch(this.g(`/messages/${encodeURIComponent(messageId)}`), {
      method: 'PUT',
      body: JSON.stringify({ folders: [folderId] }),
    })
  }

  async setMessageFlags(messageId: string, flags: { unread?: boolean; starred?: boolean }): Promise<void> {
    await nylasFetch(this.g(`/messages/${encodeURIComponent(messageId)}`), {
      method: 'PUT',
      body: JSON.stringify(flags),
    })
  }
}

// ---------- hosted OAuth (app-level; not per-grant) ----------

// Build the Nylas hosted-auth URL. Omit `provider` to let the user pick (personal connect);
// pass 'microsoft' for the known hlc105 shared mailbox.
export function nylasBuildAuthUrl(opts: { state: string; provider?: string; loginHint?: string }): string {
  const q = new URLSearchParams()
  q.set('client_id', nylasClientId() || '')
  q.set('redirect_uri', nylasRedirectUri())
  q.set('response_type', 'code')
  q.set('access_type', 'online')
  if (opts.provider) q.set('provider', opts.provider)
  if (opts.loginHint) q.set('login_hint', opts.loginHint)
  q.set('state', opts.state)
  return `${nylasApiUri()}/v3/connect/auth?${q.toString()}`
}

// Exchange an authorization code for a grant, then fetch the grant to resolve email + provider.
export async function nylasExchangeCode(code: string): Promise<MailGrant> {
  const res = await fetch(`${nylasApiUri()}/v3/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: nylasClientId(),
      client_secret: nylasApiKey(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: nylasRedirectUri(),
      code_verifier: 'nylas',
    }),
    cache: 'no-store',
  })
  const tok = (await res.json().catch(() => null)) as
    | { grant_id?: string; email?: string; provider?: string; error?: string; error_description?: string }
    | null
  if (!res.ok || !tok?.grant_id) {
    throw new Error(`Nylas token exchange failed: ${tok?.error_description || tok?.error || res.status}`)
  }
  let email = tok.email || ''
  let provider = tok.provider || null
  if (!email) {
    try {
      const { data } = await nylasFetch<{ email?: string; provider?: string }>(
        `/v3/grants/${encodeURIComponent(tok.grant_id)}`
      )
      email = data?.email || ''
      provider = data?.provider || provider
    } catch {
      /* best-effort; email may be blank until first sync */
    }
  }
  return { grantId: tok.grant_id, email, underlyingProvider: provider }
}

// Revoke (delete) a grant at Nylas when a mailbox is disconnected.
export async function nylasRevokeGrant(grantId: string): Promise<void> {
  try {
    await nylasFetch(`/v3/grants/${encodeURIComponent(grantId)}`, { method: 'DELETE' })
  } catch {
    /* best-effort */
  }
}
