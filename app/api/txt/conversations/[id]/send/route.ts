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
          .select('company_default_signature, allow_user_signatures')
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
      | { company_default_signature?: string | null; allow_user_signatures?: boolean | null }
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
  }

  const directContact = isGroup
    ? null
    : (Array.isArray(conv.contact) ? conv.contact[0] : conv.contact)

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
    const senderName = perms.role
      ? (await admin.from('hub_users').select('display_name').eq('id', user.id).maybeSingle())
          .data?.display_name || undefined
      : undefined
    const result = await twilioConvSendMessage({
      conversationSid: conv.twilio_conversation_sid,
      body: finalText,
      author: senderName,
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
  // Session 54.5: convert R2 storage keys to public /api/txt/media URLs so
  // Twilio can fetch them. mediaUrls coming from the client are storage_path
  // values returned by /api/txt/upload (e.g. "txt/{company}/12345-abc.jpg").
  // Anything that already looks like an http(s) URL passes through unchanged
  // (useful for testing or for future direct-link sends).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const publicMediaUrls = mediaUrls.map((m) =>
    /^https?:\/\//i.test(m) ? m : `${baseUrl}/api/txt/media/${m}`
  )
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
