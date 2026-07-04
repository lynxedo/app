import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import { sendDirectTxtMessage } from '@/lib/txt-send'
import {
  authenticateExtensionRequest,
  enforceRateLimit,
  EXTENSION_CORS_HEADERS,
  extensionPreflight,
} from '@/lib/extension-auth'

// POST /api/extension/text  (token-gated)
// Body: { phone?, name?, body, contact_id?, template_id? }
// Returns: { ok, conversation_id, message_id, status, error? }
//
// Sends a text from the extension. Finds-or-creates the contact + the direct
// conversation (owned by the token's user, same as tapping Text in the app),
// then composes + sends via the shared sendDirectTxtMessage helper so the
// signature + opt-out compliance rules match the interactive Txt inbox exactly.

export function OPTIONS() {
  return extensionPreflight()
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...EXTENSION_CORS_HEADERS },
  })
}

export async function POST(request: Request) {
  const auth = await authenticateExtensionRequest(request)
  if (!auth) return json({ error: 'Unauthorized' }, 401)
  const { userId, companyId } = auth

  // Texts are the highest-risk action (real SMS, A2P compliance). Cap per-minute
  // bursts and daily volume per token.
  const limited = enforceRateLimit([
    { key: `ext:text:min:${auth.tokenId}`, limit: 15, windowMs: 60_000 },
    { key: `ext:text:day:${auth.tokenId}`, limit: 200, windowMs: 86_400_000 },
  ])
  if (limited) return limited

  const body = await request.json().catch(() => ({}))
  const text: string = typeof body.body === 'string' ? body.body.trim() : ''
  const templateId: string | null =
    typeof body.template_id === 'string' && body.template_id ? body.template_id : null
  const providedContactId: string | null =
    typeof body.contact_id === 'string' && body.contact_id ? body.contact_id : null

  if (!text) return json({ error: 'Empty message' }, 400)

  const admin = createAdminClient()

  // ── Resolve the contact ─────────────────────────────────────────────────────
  type Contact = { id: string; phone: string | null; name: string | null; do_not_text: boolean }
  let contact: Contact | null = null

  if (providedContactId) {
    const { data } = await admin
      .from('txt_contacts')
      .select('id, phone, name, do_not_text')
      .eq('company_id', companyId)
      .eq('id', providedContactId)
      .maybeSingle()
    if (data) contact = data as Contact
  }

  if (!contact) {
    const e164 = toE164(typeof body.phone === 'string' ? body.phone : '')
    if (!e164) return json({ error: 'A phone number (or known contact_id) is required' }, 400)
    const name: string = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '') || e164

    const { data: existing } = await admin
      .from('txt_contacts')
      .select('id, phone, name, do_not_text')
      .eq('company_id', companyId)
      .eq('phone', e164)
      .maybeSingle()
    if (existing) {
      contact = existing as Contact
    } else {
      // New contact created via the extension → textable + in the directory
      // (consent assumed; see add-contact / PRD §4.3.1).
      const { data: created, error } = await admin
        .from('txt_contacts')
        .insert({
          company_id: companyId,
          phone: e164,
          phone_digits: e164.replace(/\D/g, '').slice(-10),
          name,
          do_not_text: false,
          in_directory: true,
          sources: ['extension'],
        })
        .select('id, phone, name, do_not_text')
        .single()
      if (error || !created) return json({ error: error?.message || 'Contact create failed' }, 500)
      contact = created as Contact
    }
  }

  if (!contact) return json({ error: 'Contact not found' }, 404)

  // ── Find-or-create the direct conversation, owned by the token's user ───────
  let conversationId: string
  const { data: existingConv } = await admin
    .from('txt_conversations')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('contact_id', contact.id)
    .eq('kind', 'direct')
    .maybeSingle()

  if (existingConv) {
    conversationId = existingConv.id as string
    if (existingConv.status === 'archived') {
      // Reopen + take ownership (mirrors /conversations/start).
      await admin
        .from('txt_conversations')
        .update({ status: 'assigned', assigned_to: userId, archived_by: null })
        .eq('id', conversationId)
      await admin
        .from('txt_conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('role', 'owner')
      await admin.from('txt_conversation_members').insert({
        conversation_id: conversationId,
        user_id: userId,
        role: 'owner',
        added_by: userId,
      })
    }
  } else {
    const { data: createdConv, error: convErr } = await admin
      .from('txt_conversations')
      .insert({
        company_id: companyId,
        contact_id: contact.id,
        assigned_to: userId,
        status: 'assigned',
        kind: 'direct',
      })
      .select('id')
      .single()
    if (convErr || !createdConv) return json({ error: convErr?.message || 'Conversation create failed' }, 500)
    conversationId = createdConv.id as string
    await admin.from('txt_conversation_members').insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'owner',
      added_by: userId,
    })
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  const result = await sendDirectTxtMessage({
    admin,
    companyId,
    conversationId,
    contact,
    userId,
    body: text,
    templateId,
  })

  return json({ ...result, conversation_id: conversationId }, result.ok ? 200 : 200)
}
