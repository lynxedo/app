import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import { enrichTxtContactName } from '@/lib/dialer-lookup'

type Admin = ReturnType<typeof createAdminClient>

// Unified Inbox Session 6 — Option A: a missed inbound call or a voicemail
// behaves exactly like an inbound text. It lands inline in an existing open
// thread (the S2 timeline merge surfaces the marker), or — when there's no
// open conversation — it creates/reopens an UNASSIGNED (Queue) item so the
// office can triage it like any other inbound. Claiming is an explicit action,
// never a side effect of the call landing here.
//
// IMPORTANT: these helpers run inside the Twilio voice webhooks, which point at
// PROD (main). They only take effect for real traffic at the prod cutover.
// Every call site wraps them so they can NEVER break the live call flow.

// Find the contact for an inbound phone number, creating one if it's brand new
// (mirrors the inbound-SMS find-or-create so a first-touch call gets a contact
// and a real name from the Jobber mirror when available).
export async function findOrCreateContactByPhone(
  admin: Admin,
  companyId: string,
  rawPhone: string
): Promise<string | null> {
  const phone = toE164(rawPhone || '')
  if (!phone) return null

  const { data: existing } = await admin
    .from('txt_contacts')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('phone', phone)
    .maybeSingle()
  if (existing) {
    // Upgrade a phone-as-name placeholder from the Jobber mirror, best-effort.
    if (existing.name === phone) {
      await enrichTxtContactName(companyId, phone).catch(() => {})
    }
    return existing.id
  }

  const jobberName = await enrichTxtContactName(companyId, phone).catch(() => null)
  const { data: created, error } = await admin
    .from('txt_contacts')
    .insert({ company_id: companyId, phone, phone_digits: phone.replace(/\D/g, '').slice(-10), name: jobberName || phone, in_directory: false })
    .select('id')
    .single()
  if (error || !created) {
    console.warn('[txt-queue] contact create failed', error)
    return null
  }
  return created.id
}

// Ensure the contact has a triage-able conversation for an inbound call/VM.
//   - open (non-archived) thread already exists → leave ownership alone; the
//     call/VM marker already shows inline via the timeline merge. (We still
//     broadcast so an open rail updates live.)
//   - archived thread → reopen to a CLEAN unassigned Queue item: clear the
//     stale owner + members (same fix as the inbound-SMS reopen).
//   - no thread → create a fresh unassigned Queue item.
// Returns the conversation id (or null on failure). Idempotent — safe to call
// from both the voicemail-complete and the no-answer paths for one missed call.
export async function ensureInboundQueueConversation(
  admin: Admin,
  args: { companyId: string; contactId: string; preview: string; at?: string }
): Promise<string | null> {
  const { companyId, contactId, preview } = args
  const at = args.at || new Date().toISOString()

  const { data: existing } = await admin
    .from('txt_conversations')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('contact_id', contactId)
    .eq('kind', 'direct')
    .maybeSingle()

  let conversationId: string
  if (existing) {
    conversationId = existing.id
    if (existing.status === 'archived') {
      // Reopen as a clean, unowned Queue item.
      await admin
        .from('txt_conversations')
        .update({
          status: 'unassigned',
          assigned_to: null,
          archived_by: null,
          last_message_at: at,
          last_inbound_at: at,
          last_message_preview: preview,
          last_message_direction: 'inbound',
        })
        .eq('id', conversationId)
      await admin
        .from('txt_conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
    } else {
      // Open thread — just bump the inbound marker so it sorts up + shows
      // unread. Don't touch ownership, and don't clobber the text snippet.
      await admin
        .from('txt_conversations')
        .update({ last_inbound_at: at })
        .eq('id', conversationId)
    }
  } else {
    const { data: created, error } = await admin
      .from('txt_conversations')
      .insert({
        company_id: companyId,
        contact_id: contactId,
        kind: 'direct',
        status: 'unassigned',
        last_message_at: at,
        last_inbound_at: at,
        last_message_preview: preview,
        last_message_direction: 'inbound',
      })
      .select('id')
      .single()
    if (error || !created) {
      console.warn('[txt-queue] conversation create failed', error)
      return null
    }
    conversationId = created.id
  }

  // Realtime: light the Queue for the manager/triage audience (same scoping the
  // inbound-SMS push uses — never every Txt2 viewer).
  try {
    const { data: managers } = await admin
      .from('user_profiles')
      .select('id, role, can_admin_txt, can_assign_txt_threads')
      .eq('company_id', companyId)
    const recipientIds = (managers ?? [])
      .filter(
        (m) =>
          m.role === 'admin' ||
          m.can_admin_txt === true ||
          m.can_assign_txt_threads === true
      )
      .map((m) => m.id)
    const channel = admin.channel(`txt:${companyId}`)
    await channel.subscribe()
    await channel.send({
      type: 'broadcast',
      event: 'inbound',
      payload: {
        conversation_id: conversationId,
        contact_id: contactId,
        recipient_ids: recipientIds,
      },
    })
    await admin.removeChannel(channel)
  } catch (e) {
    console.warn('[txt-queue] broadcast failed', e)
  }

  return conversationId
}
