import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  twilioConvCreate,
  twilioConvAddSmsParticipant,
  twilioConvAddWebhook,
  twilioConfigured,
} from '@/lib/twilio'
import { resolveFromNumber } from '@/lib/txt-numbers'
import { TXT_GROUPS_ENABLED } from '@/lib/txt-features'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// POST /api/txt/conversations/start-group
// Body: { contact_ids: string[], name?: string }
//
// Creates a kind='group' conversation, adds the caller as owner, attaches
// every requested contact via txt_conversation_contacts, and (when Twilio
// is configured) provisions the matching Twilio Conversations resource +
// adds each contact as an SMS participant.
//
// When Twilio is not configured (staging dev mode), the row is created
// without a twilio_conversation_sid; sends from the conversation will
// fail with `group_not_provisioned` until creds + a real Conversations
// resource exist. Mirrors the same not-configured pattern as 1:1 sends.
export async function POST(request: Request) {
  // Group messaging is currently disabled (see lib/txt-features.ts).
  if (!TXT_GROUPS_ENABLED) {
    return NextResponse.json(
      { error: 'Group messaging is currently turned off.' },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const contactIds: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : []
  const friendlyName: string = (body.name || '').trim()

  if (contactIds.length < 2) {
    return NextResponse.json(
      { error: 'A group needs at least 2 contacts' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Validate every contact belongs to this company AND has a phone.
  const { data: contacts, error: cErr } = await admin
    .from('txt_contacts')
    .select('id, name, phone, do_not_text')
    .eq('company_id', HEROES_COMPANY_ID)
    .in('id', contactIds)
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }
  if (!contacts || contacts.length !== contactIds.length) {
    return NextResponse.json(
      { error: 'One or more contacts not found' },
      { status: 400 }
    )
  }
  const missingPhone = contacts.find((c) => !c.phone)
  if (missingPhone) {
    return NextResponse.json(
      { error: `Contact "${missingPhone.name}" has no phone` },
      { status: 400 }
    )
  }
  const blocked = contacts.find((c) => c.do_not_text)
  if (blocked) {
    return NextResponse.json(
      { error: `"${blocked.name}" is marked do-not-text` },
      { status: 400 }
    )
  }

  // Resolve the from-number once up front (Twilio Conversations binds the
  // proxy address per-participant at provisioning time — can't be changed
  // later without re-creating the Conversation resource).
  const fromNumber = await resolveFromNumber(admin, {
    userId: user.id,
    companyId: HEROES_COMPANY_ID,
  })

  // Optional: provision the Twilio Conversation up front. If creds aren't
  // there, leave twilio_conversation_sid null — the send route will surface
  // a clear error rather than try to fake it.
  let twilioConversationSid: string | null = null
  if (twilioConfigured()) {
    const created = await twilioConvCreate({
      friendlyName: friendlyName || `Group · ${contacts.map((c) => c.name).join(', ').slice(0, 80)}`,
    })
    if (!created.ok) {
      return NextResponse.json(
        { error: `Twilio Conversations create failed: ${created.error}` },
        { status: 502 }
      )
    }
    twilioConversationSid = created.sid

    // Attach a conversation-scoped inbound webhook so participant replies land
    // back in THIS thread (and this environment). Best-effort — a failure only
    // means replies won't show in-app; outbound still works.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
    const hook = await twilioConvAddWebhook({
      conversationSid: twilioConversationSid,
      url: `${baseUrl}/api/txt/twilio/conversations`,
    })
    if (!hook.ok) {
      console.warn('[start-group] webhook attach failed', hook.error)
    }

    // Add each contact as an SMS participant. Bail on the first failure
    // so we don't leave a half-built group lying around.
    for (const c of contacts) {
      const addRes = await twilioConvAddSmsParticipant({
        conversationSid: twilioConversationSid,
        contactPhone: c.phone,
        proxyNumber: fromNumber || undefined,
      })
      if (!addRes.ok) {
        return NextResponse.json(
          { error: `Failed to add ${c.name} to Twilio group: ${addRes.error}` },
          { status: 502 }
        )
      }
    }
  }

  const { data: createdConv, error: convErr } = await admin
    .from('txt_conversations')
    .insert({
      company_id: HEROES_COMPANY_ID,
      contact_id: null,
      assigned_to: user.id,
      status: 'assigned',
      kind: 'group',
      twilio_conversation_sid: twilioConversationSid,
    })
    .select('id')
    .single()
  if (convErr || !createdConv) {
    return NextResponse.json(
      { error: convErr?.message || 'Conversation insert failed' },
      { status: 500 }
    )
  }

  // Caller becomes owner; every contact is attached.
  await admin.from('txt_conversation_members').insert({
    conversation_id: createdConv.id,
    user_id: user.id,
    role: 'owner',
    added_by: user.id,
  })
  await admin.from('txt_conversation_contacts').insert(
    contacts.map((c) => ({
      conversation_id: createdConv.id,
      contact_id: c.id,
    }))
  )

  return NextResponse.json({
    conversation_id: createdConv.id,
    twilio_provisioned: Boolean(twilioConversationSid),
  })
}
