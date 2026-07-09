import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  twilioConvCreate,
  twilioConvAddGroupParticipant,
  twilioConvAddProjectedAddress,
  twilioConvAddWebhook,
  twilioConvDelete,
  twilioConfigured,
} from '@/lib/twilio'
import { userHasBetaFeature } from '@/lib/beta-flags'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// Toll-free prefixes can't exchange group texts (Twilio: Group MMS is +1 LONG
// CODES only). Used to pick which of our numbers a group runs on.
const TOLL_FREE_PREFIXES = ['800', '888', '877', '866', '855', '844', '833']
function isTollFree(e164: string): boolean {
  const m = e164.match(/^\+1(\d{3})/)
  return !!m && TOLL_FREE_PREFIXES.includes(m[1])
}

// POST /api/txt/conversations/start-group
// Body: { contact_ids: string[], name?: string }
//
// Creates a kind='group' conversation backed by a TRUE Group MMS Twilio
// Conversation (projected-address model — NOT the proxy/relay model that
// absorbed members' 1:1 texts in June 2026):
//   - every contact joins with an ADDRESS-ONLY messaging binding
//   - our long-code number joins as a standalone ProjectedAddress
// Thread identity at the carrier is the full participant set, so a member's
// ordinary 1:1 text to the same number stays a separate thread, and everyone
// in the group sees everyone's messages — like a native phone group text.
//
// Constraints (Twilio Group MMS): +1 long codes only (toll-free excluded),
// max 10 total participants → us + up to 9 contacts, US/Canada mobiles.
//
// Gated by the txt_groups Beta feature (Settings → Beta Features).
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_txt, can_admin_txt, can_assign_txt_threads, can_access_beta, company_id')
    .eq('id', user.id)
    .single()
  const isTxtUser =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true ||
    profile?.can_access_txt === true
  if (!isTxtUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Group texting is a Beta feature (txt_groups): available + this user opted in.
  const hasGroupsBeta = await userHasBetaFeature(admin, user.id, 'txt_groups', {
    canAccessBeta: profile?.role === 'admin' || profile?.can_access_beta === true,
    companyId: profile?.company_id ?? null,
  })
  if (!hasGroupsBeta) {
    return NextResponse.json(
      { error: 'Group texting is in beta — enable it in Settings → Beta Features.' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const contactIds: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : []
  const friendlyName: string = (body.name || '').trim()

  if (contactIds.length < 2) {
    return NextResponse.json(
      { error: 'A group needs at least 2 contacts' },
      { status: 400 }
    )
  }
  // Group MMS caps at 10 total participants; our projected number is one of them.
  if (contactIds.length > 9) {
    return NextResponse.json(
      { error: 'A group text can hold at most 9 contacts (plus us)' },
      { status: 400 }
    )
  }

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

  // Groups are pinned to a LONG CODE — Twilio can't group-text from toll-free.
  // Prefer the company default if it's a long code, else the first long code.
  const { data: numbers } = await admin
    .from('txt_phone_numbers')
    .select('id, twilio_number, label, is_default')
    .eq('company_id', HEROES_COMPANY_ID)
    .order('is_default', { ascending: false })
    .order('label', { ascending: true })
  const groupNumber = (numbers ?? []).find(
    (n) => n.twilio_number && !isTollFree(n.twilio_number)
  )
  if (!groupNumber) {
    return NextResponse.json(
      { error: 'Group texts need a local (non toll-free) number — none is configured.' },
      { status: 400 }
    )
  }

  // Provision the Twilio Group MMS conversation up front. If creds aren't
  // there (staging dev mode), leave twilio_conversation_sid null — the send
  // route surfaces a clear error rather than faking it.
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

    // Our number joins as the standalone projected address, then each contact
    // joins address-only. On ANY failure, DELETE the half-built conversation at
    // Twilio (June lesson: the resource outlives our DB rows otherwise).
    const projRes = await twilioConvAddProjectedAddress({
      conversationSid: twilioConversationSid,
      projectedNumber: groupNumber.twilio_number,
    })
    if (!projRes.ok) {
      await twilioConvDelete({ conversationSid: twilioConversationSid })
      return NextResponse.json(
        { error: `Failed to add our number to the group: ${projRes.error}` },
        { status: 502 }
      )
    }
    for (const c of contacts) {
      const addRes = await twilioConvAddGroupParticipant({
        conversationSid: twilioConversationSid,
        contactPhone: c.phone,
      })
      if (!addRes.ok) {
        await twilioConvDelete({ conversationSid: twilioConversationSid })
        return NextResponse.json(
          { error: `Failed to add ${c.name} to the group: ${addRes.error}` },
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
      phone_number_id: groupNumber.id,
    })
    .select('id')
    .single()
  if (convErr || !createdConv) {
    // Don't leave a live Twilio group with no app-side conversation.
    if (twilioConversationSid) {
      await twilioConvDelete({ conversationSid: twilioConversationSid })
    }
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
