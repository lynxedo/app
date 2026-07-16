import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendSms,
  twilioConfigured,
  twilioConvSendMessage,
} from '@/lib/twilio'
import { renderTemplate } from '@/lib/txt-templates'
import { getTxtConvPermissions } from '@/lib/txt-permissions'
import { resolveFromNumber } from '@/lib/txt-numbers'
import { buildMessagePreview } from '@/lib/txt-preview'
import { twilioMediaUrls } from '@/lib/txt-media-sign'
import { seizeAmberThreadForHuman } from '@/lib/amber-text'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: conversationId } = await params
  const body = await request.json().catch(() => ({}))
  let text: string = (body.body || '').trim()
  const mediaUrls: string[] = Array.isArray(body.media_urls) ? body.media_urls : []
  const templateId: string | null =
    typeof body.template_id === 'string' && body.template_id ? body.template_id : null

  if (!text && mediaUrls.length === 0) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }

  const { data: conv, error: convErr } = await supabase
    .from('txt_conversations')
    .select(
      `id, kind, contact_id, status, twilio_conversation_sid,
       contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, phone, do_not_text )`
    )
    .eq('id', conversationId)
    .single()
  if (convErr || !conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const isGroup = conv.kind === 'group'

  // For group conversations we need the participant list to:
  //   (a) display the body to the right contact name on template render and
  //   (b) gate do-not-text — if ANY participant is do-not-text we still send
  //       to the rest, but we surface a warning. v1: just skip do-not-text.
  let groupContacts: Array<{ id: string; name: string; phone: string; do_not_text: boolean }> = []
  if (isGroup) {
    const { data: gc } = await supabase
      .from('txt_conversation_contacts')
      .select('contact:txt_contacts!txt_conversation_contacts_contact_id_fkey ( id, name, phone, do_not_text )')
      .eq('conversation_id', conversationId)
    groupContacts = (gc ?? [])
      .map((row) => {
        const inner = Array.isArray(row.contact) ? row.contact[0] : row.contact
        return inner as { id: string; name: string; phone: string; do_not_text: boolean } | null
      })
      .filter(Boolean) as typeof groupContacts
  } else {
    const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact
    if (!contact?.phone) {
      return NextResponse.json({ error: 'Contact has no phone' }, { status: 400 })
    }
    if (contact.do_not_text) {
      return NextResponse.json(
        { error: 'Contact is marked do-not-text' },
        { status: 400 }
      )
    }
  }

  // Permission: caller must be the owner or an added member. Claiming an
  // unassigned (Queue) thread, or joining one owned by someone else, is now an
  // EXPLICIT action (the Claim / Join buttons) — never a side effect of typing
  // a reply. A non-participant is rejected here and must Claim or Join first.
  const perms = await getTxtConvPermissions(supabase, conversationId, user.id)
  if (!perms.canReply) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Amber-over-text seize: a real teammate replying takes over the thread, so
  // Amber goes silent. No-op unless Amber is actively driving this conversation.
  // Best-effort (never throws) so it can't affect the send.
  await seizeAmberThreadForHuman(admin, { conversationId, userId: user.id })

  const directContact = isGroup
    ? null
    : (Array.isArray(conv.contact) ? conv.contact[0] : conv.contact)

  // Resolve the merge-field render context once — used for the template body AND
  // the signature (so a company default like "{first_name}, - Heroes" fills in).
  let finalText = text
  if (text) {
    const [{ data: sender }, { data: company }, { data: profile }, { data: txtSettings }] =
      await Promise.all([
        admin.from('hub_users').select('display_name').eq('id', user.id).maybeSingle(),
        admin.from('companies').select('name').eq('id', HEROES_COMPANY_ID).maybeSingle(),
        supabase.from('user_profiles').select('txt_signature').eq('id', user.id).maybeSingle(),
        admin
          .from('txt_settings')
          .select(
            'company_default_signature, allow_user_signatures, opt_out_message, opt_out_on_first_message'
          )
          .eq('company_id', HEROES_COMPANY_ID)
          .maybeSingle(),
      ])

    // For groups, use the first participant's name for {first_name}
    // (good enough for v1; group templates usually skip per-contact fields).
    const contactName = isGroup
      ? groupContacts[0]?.name || null
      : (Array.isArray(conv.contact) ? conv.contact[0] : conv.contact)?.name || null
    const renderCtx = {
      contactName,
      senderName: sender?.display_name || null,
      companyName: company?.name || null,
    }

    // Render template body fields (only when a template was used).
    if (templateId) {
      text = renderTemplate(text, renderCtx)
      finalText = text
    }

    // Signature: personal wins when allowed; otherwise the company default.
    const settings = txtSettings as
      | {
          company_default_signature?: string | null
          allow_user_signatures?: boolean | null
          opt_out_message?: string | null
          opt_out_on_first_message?: boolean | null
        }
      | null
    const allowUserSig = settings?.allow_user_signatures !== false // default true
    const personalSig = (profile?.txt_signature || '').trim()
    const companySig = (settings?.company_default_signature || '').trim()
    let signature = allowUserSig && personalSig ? personalSig : companySig

    if (signature) {
      // Don't repeat the signature back-to-back from the same sender.
      const { data: lastOut } = await admin
        .from('txt_messages')
        .select('sent_by')
        .eq('conversation_id', conversationId)
        .eq('direction', 'outbound')
        .neq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!lastOut || lastOut.sent_by !== user.id) {
        signature = renderTemplate(signature, renderCtx)
        finalText = `${text}\n\n${signature}`
      }
    }

    // Compliance — on the FIRST outbound text to a contact, append the opt-out
    // notice (carrier/CTIA require opt-out language on the initial message).
    // Direct 1-to-1 only. Configurable + toggleable in txt_settings
    // (defaults: enabled, "Reply STOP to opt out.").
    const optOutEnabled = settings?.opt_out_on_first_message !== false
    const optOutMsg = (settings?.opt_out_message ?? 'Reply STOP to opt out.').trim()
    if (!isGroup && directContact?.id && optOutEnabled && optOutMsg) {
      const { data: priorOutbound } = await admin
        .from('txt_messages')
        .select('id')
        .eq('contact_id', directContact.id)
        .eq('direction', 'outbound')
        .neq('status', 'failed')
        .limit(1)
        .maybeSingle()
      if (!priorOutbound) {
        // First time texting this contact — hug the signature with a single
        // newline when one was appended, otherwise leave a blank line.
        const sep = finalText === text ? '\n\n' : '\n'
        finalText = `${finalText}${sep}${optOutMsg}`
      }
    }
  }

  const { data: inserted, error: insertErr } = await admin
    .from('txt_messages')
    .insert({
      company_id: HEROES_COMPANY_ID,
      conversation_id: conversationId,
      contact_id: directContact?.id ?? null,
      direction: 'outbound',
      body: finalText || null,
      media_urls: mediaUrls,
      sent_by: user.id,
      status: 'sending',
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    console.error('[txt/send] message insert failed', insertErr)
    return NextResponse.json(
      { error: insertErr?.message || 'Insert failed' },
      { status: 500 }
    )
  }

  await admin
    .from('txt_conversations')
    .update({
      last_message_at: new Date().toISOString(),
      // Preview uses the message body (pre-signature) so the sidebar snippet
      // isn't dominated by the appended signature.
      last_message_preview: buildMessagePreview(text, mediaUrls.length),
      last_message_direction: 'outbound',
    })
    .eq('id', conversationId)

  if (!twilioConfigured()) {
    await admin
      .from('txt_messages')
      .update({
        status: 'failed',
        error_message: 'Twilio not configured (staging dev mode)',
      })
      .eq('id', inserted.id)
    return NextResponse.json({
      ok: false,
      message_id: inserted.id,
      error: 'twilio_not_configured',
      status: 'failed',
    })
  }

  const statusCallback =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com') +
    '/api/txt/twilio/sms/status'

  if (isGroup) {
    if (!conv.twilio_conversation_sid) {
      // Conversation was created in staging-only mode (no Twilio resource).
      // Mark this attempt failed clearly so it shows in history.
      await admin
        .from('txt_messages')
        .update({
          status: 'failed',
          error_message: 'Group conversation has no Twilio Conversations SID — not provisioned',
        })
        .eq('id', inserted.id)
      return NextResponse.json({
        ok: false,
        message_id: inserted.id,
        error: 'group_not_provisioned',
        status: 'failed',
      })
    }
    // Photos aren't wired for groups yet (Conversations REST needs a separate
    // media upload pipeline, not the plain MediaUrl the SMS API takes). Fail
    // loudly instead of silently sending the text without the photo.
    if (mediaUrls.length > 0) {
      await admin
        .from('txt_messages')
        .update({
          status: 'failed',
          error_message: 'Photos in group texts aren’t supported yet — send text only',
        })
        .eq('id', inserted.id)
      return NextResponse.json({
        ok: false,
        message_id: inserted.id,
        error: 'group_media_not_supported',
        status: 'failed',
      })
    }
    // Group MMS (projected-address model): the REST author MUST be the group's
    // projected number — our long code the group was provisioned on (the
    // conversation is pinned to it via phone_number_id, so the resolver's
    // per-conversation tier returns it). A display-name author would be treated
    // as a chat identity with no projected address and the send would fail.
    const projectedNumber = await resolveFromNumber(admin, {
      conversationId,
      companyId: HEROES_COMPANY_ID,
    })
    if (!projectedNumber) {
      await admin
        .from('txt_messages')
        .update({
          status: 'failed',
          error_message: 'Group has no pinned sending number — recreate the group',
        })
        .eq('id', inserted.id)
      return NextResponse.json({
        ok: false,
        message_id: inserted.id,
        error: 'group_number_missing',
        status: 'failed',
      })
    }
    const result = await twilioConvSendMessage({
      conversationSid: conv.twilio_conversation_sid,
      body: finalText,
      author: projectedNumber,
    })
    if (!result.ok) {
      await admin
        .from('txt_messages')
        .update({ status: 'failed', error_message: result.error })
        .eq('id', inserted.id)
      return NextResponse.json({
        ok: false,
        message_id: inserted.id,
        error: result.error,
        code: result.code,
      })
    }
    await admin
      .from('txt_messages')
      .update({ twilio_sid: result.sid, status: 'sent' })
      .eq('id', inserted.id)
    return NextResponse.json({
      ok: true,
      message_id: inserted.id,
      twilio_sid: result.sid,
      status: result.status,
    })
  }

  // Direct 1-to-1
  // Session 54: resolve the From number for this send. Per-conversation override
  // → user default → company default. sendSms falls back to env if null.
  const fromNumber = await resolveFromNumber(admin, {
    conversationId,
    userId: user.id,
    companyId: HEROES_COMPANY_ID,
  })
  // Stamp which of our numbers this send used (powers per-message line labels +
  // the reroute check in the status webhook). Look up the resolved From's id.
  let fromNumberId: string | null = null
  if (fromNumber) {
    const { data: pn } = await admin
      .from('txt_phone_numbers')
      .select('id')
      .eq('company_id', HEROES_COMPANY_ID)
      .eq('twilio_number', fromNumber)
      .maybeSingle()
    fromNumberId = pn?.id ?? null
  }
  // mediaUrls are storage_path keys from /api/txt/upload (e.g.
  // "txt/{company}/12345-abc.jpg"). Hand Twilio a DIRECT R2 presigned URL — NOT
  // our /api/txt/media route — because Cloudflare's edge blocks Twilio's media
  // fetcher on our own domain (403 → Twilio error 11200 "HTTP retrieval
  // failure"). In-app rendering still uses the session-gated route. See
  // lib/txt-media-sign.ts. Already-absolute http(s) URLs pass through unchanged.
  const publicMediaUrls = await twilioMediaUrls(mediaUrls)
  const result = await sendSms({
    to: directContact!.phone,
    body: finalText,
    mediaUrls: publicMediaUrls.length ? publicMediaUrls : undefined,
    statusCallback,
    fromNumber: fromNumber || undefined,
  })

  if (!result.ok) {
    await admin
      .from('txt_messages')
      .update({ status: 'failed', error_message: result.error, phone_number_id: fromNumberId })
      .eq('id', inserted.id)
    return NextResponse.json({
      ok: false,
      message_id: inserted.id,
      error: result.error,
      code: result.code,
    })
  }

  await admin
    .from('txt_messages')
    .update({ twilio_sid: result.sid, status: 'sent', phone_number_id: fromNumberId })
    .eq('id', inserted.id)

  return NextResponse.json({
    ok: true,
    message_id: inserted.id,
    twilio_sid: result.sid,
    status: result.status,
  })
}
