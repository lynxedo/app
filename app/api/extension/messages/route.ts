import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import {
  authenticateExtensionRequest,
  enforceRateLimit,
  tokenUserHasModuleAccess,
  EXTENSION_CORS_HEADERS,
  extensionPreflight,
} from '@/lib/extension-auth'

// GET /api/extension/messages  (token-gated, READ-ONLY)
// Query: ?conversation_id= | ?contact_id= | ?phone=   (&limit=6)
// Returns: { found, conversation_id, contact_id, contact_name, do_not_text,
//            messages: [...oldest→newest], has_more }
//
// The recent history shown above the extension's compose box, so a text is sent
// with the conversation in view instead of blind.
//
// Two properties this route must keep:
//  1. It NEVER writes. Opening the composer on someone we've never texted must
//     not create a contact or a conversation — only pressing Send does that
//     (see ../text/route.ts). A stranger simply returns found:false.
//  2. It resolves the thread the SAME WAY the send route does, so what you read
//     is what you reply into. If this matched more loosely (e.g. by last-10
//     digits while send matches the exact E.164), you could read one person's
//     history and send to a different, newly created contact.

export function OPTIONS() {
  return extensionPreflight()
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...EXTENSION_CORS_HEADERS },
  })
}

const DEFAULT_LIMIT = 6
const MAX_LIMIT = 20

const EMPTY = {
  found: false,
  conversation_id: null,
  contact_id: null,
  contact_name: null,
  do_not_text: false,
  messages: [] as unknown[],
  has_more: false,
}

type ConvRow = { id: string; contact_id: string | null }
type SenderRow = { display_name: string | null } | { display_name: string | null }[] | null
type MessageRow = {
  id: string
  direction: string
  body: string | null
  media_urls: string[] | null
  status: string | null
  created_at: string
  sender: SenderRow
}

function senderName(sender: SenderRow): string | null {
  // PostgREST returns an embedded row as an object or a single-element array
  // depending on how it infers the relationship; handle both.
  const row = Array.isArray(sender) ? sender[0] : sender
  return row?.display_name ?? null
}

export async function GET(request: Request) {
  const auth = await authenticateExtensionRequest(request)
  if (!auth) return json({ error: 'Unauthorized' }, 401)
  const { userId, companyId } = auth

  const limited = enforceRateLimit([
    { key: `ext:messages:${auth.tokenId}`, limit: 60, windowMs: 60_000 },
  ])
  if (limited) return limited

  // Same gate as sending, and the same audience as the Hub itself: in the app
  // any Txt teammate can read any thread in the shared "All" inbox
  // (`canView = isTxtUser`, lib/txt-permissions.ts). This mirrors that rather
  // than inventing a second visibility rule for the extension.
  if (!(await tokenUserHasModuleAccess(userId, 'txt'))) {
    return json({ error: 'This account is not enabled for texting.' }, 403)
  }

  const url = new URL(request.url)
  const conversationIdParam = url.searchParams.get('conversation_id')
  const contactIdParam = url.searchParams.get('contact_id')
  const phoneParam = url.searchParams.get('phone')

  const parsedLimit = Number.parseInt(url.searchParams.get('limit') || '', 10)
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  const admin = createAdminClient()

  // ── Resolve the conversation (read-only) ────────────────────────────────────
  let conv: ConvRow | null = null

  if (conversationIdParam) {
    // Company scope is the authorization check — a conversation id from another
    // tenant simply doesn't resolve.
    const { data } = await admin
      .from('txt_conversations')
      .select('id, contact_id')
      .eq('company_id', companyId)
      .eq('id', conversationIdParam)
      .maybeSingle()
    if (data) conv = data as ConvRow
  }

  if (!conv) {
    let contactId: string | null = contactIdParam || null

    if (!contactId && phoneParam) {
      // Exact E.164, matching ../text/route.ts — see note (2) at the top.
      const e164 = toE164(phoneParam)
      if (!e164) return json(EMPTY)
      const { data } = await admin
        .from('txt_contacts')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone', e164)
        .maybeSingle()
      contactId = (data?.id as string) ?? null
    }

    if (!contactId) return json(EMPTY)

    const { data } = await admin
      .from('txt_conversations')
      .select('id, contact_id')
      .eq('company_id', companyId)
      .eq('contact_id', contactId)
      .eq('kind', 'direct')
      .maybeSingle()
    if (!data) {
      // Known contact, but nobody has ever texted them. Still report who they
      // are so the panel can show the do-not-text state before you type.
      const { data: c } = await admin
        .from('txt_contacts')
        .select('id, name, do_not_text')
        .eq('company_id', companyId)
        .eq('id', contactId)
        .maybeSingle()
      return json({
        ...EMPTY,
        contact_id: c ? (c.id as string) : null,
        contact_name: (c?.name as string) || null,
        do_not_text: c?.do_not_text === true,
      })
    }
    conv = data as ConvRow
  }

  // ── Contact details ─────────────────────────────────────────────────────────
  let contactName: string | null = null
  let doNotText = false
  if (conv.contact_id) {
    const { data: c } = await admin
      .from('txt_contacts')
      .select('name, do_not_text')
      .eq('company_id', companyId)
      .eq('id', conv.contact_id)
      .maybeSingle()
    contactName = (c?.name as string) || null
    doNotText = c?.do_not_text === true
  }

  // ── Newest N messages, returned oldest→newest ───────────────────────────────
  // Fetch one extra to tell whether there's more history behind the window,
  // which is what turns on the "open the full thread in Hub" hint.
  const { data: rows } = await admin
    .from('txt_messages')
    .select(
      'id, direction, body, media_urls, status, created_at, sender:hub_users!sent_by ( display_name )'
    )
    .eq('company_id', companyId)
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  const newestFirst = (rows ?? []) as MessageRow[]
  const hasMore = newestFirst.length > limit
  const window = newestFirst.slice(0, limit).reverse()

  return json({
    found: true,
    conversation_id: conv.id,
    contact_id: conv.contact_id,
    contact_name: contactName,
    do_not_text: doNotText,
    has_more: hasMore,
    messages: window.map((m) => ({
      id: m.id,
      direction: m.direction, // 'inbound' | 'outbound'
      body: m.body || '',
      created_at: m.created_at,
      status: m.status,
      sender_name: m.direction === 'outbound' ? senderName(m.sender) : null,
      // Photos are reported as a count, not a URL: /api/txt/media requires a Hub
      // session, so the panel shows a "Photo" chip and links out for the image.
      media_count: Array.isArray(m.media_urls) ? m.media_urls.length : 0,
    })),
  })
}
