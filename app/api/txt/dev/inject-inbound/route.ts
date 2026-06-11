import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import { buildMessagePreview } from '@/lib/txt-preview'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// POST /api/txt/dev/inject-inbound
// Admin-only. Simulates an inbound Twilio SMS so the assignment + reply flow
// can be tested without real Twilio. Body: { phone, name?, body }
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_txt')
    .eq('id', user.id)
    .single()
  const isAdmin =
    profile?.role === 'admin' || profile?.can_admin_txt === true
  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const phoneE164 = toE164(body.phone || '')
  const text: string = (body.body || '').trim()
  const name: string = (body.name || phoneE164 || 'Test Contact').trim()

  if (!phoneE164) return NextResponse.json({ error: 'Invalid phone' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Empty body' }, { status: 400 })

  const admin = createAdminClient()
  const fakeSid = `DEV-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  // Find or create contact
  let contactId: string | undefined
  const { data: existingContact } = await admin
    .from('txt_contacts')
    .select('id')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('phone', phoneE164)
    .maybeSingle()

  if (existingContact) {
    contactId = existingContact.id
  } else {
    const { data: created, error: createErr } = await admin
      .from('txt_contacts')
      .insert({ company_id: HEROES_COMPANY_ID, phone: phoneE164, name })
      .select('id')
      .single()
    if (createErr || !created) {
      return NextResponse.json({ error: createErr?.message || 'Contact insert failed' }, { status: 500 })
    }
    contactId = created.id
  }

  // Find or reopen conversation
  let conversationId: string
  const { data: existingConv } = await admin
    .from('txt_conversations')
    .select('id, status')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('contact_id', contactId!)
    .maybeSingle()

  if (existingConv) {
    conversationId = existingConv.id
    if (existingConv.status === 'archived') {
      await admin
        .from('txt_conversations')
        .update({ status: 'unassigned' })
        .eq('id', conversationId)
    }
  } else {
    const { data: createdConv, error: convErr } = await admin
      .from('txt_conversations')
      .insert({
        company_id: HEROES_COMPANY_ID,
        contact_id: contactId!,
        status: 'unassigned',
      })
      .select('id')
      .single()
    if (convErr || !createdConv) {
      return NextResponse.json({ error: convErr?.message || 'Conversation insert failed' }, { status: 500 })
    }
    conversationId = createdConv.id
  }

  const now = new Date().toISOString()
  const { error: insertErr } = await admin.from('txt_messages').insert({
    company_id: HEROES_COMPANY_ID,
    conversation_id: conversationId,
    contact_id: contactId,
    direction: 'inbound',
    body: text,
    twilio_sid: fakeSid,
    status: 'received',
  })
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  await admin
    .from('txt_conversations')
    .update({
      last_message_at: now,
      last_inbound_at: now,
      last_message_preview: buildMessagePreview(text, 0),
      last_message_direction: 'inbound',
    })
    .eq('id', conversationId)

  return NextResponse.json({
    ok: true,
    conversation_id: conversationId,
    contact_id: contactId,
    sid: fakeSid,
  })
}
