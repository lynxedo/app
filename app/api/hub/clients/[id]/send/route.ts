import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callHeroesTool } from '@/lib/hub-claude'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { message } = body

  if (!message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  // Load contact (RLS scopes to company automatically)
  const { data: contact, error: contactErr } = await supabase
    .from('hub_contacts')
    .select('id, name, phone, do_not_text, company_id')
    .eq('id', id)
    .single()

  if (contactErr || !contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  if (contact.do_not_text) {
    return NextResponse.json({ error: 'This contact is marked do-not-text' }, { status: 422 })
  }

  // Get hub_users row for sender FK
  const { data: hubUser } = await supabase
    .from('hub_users')
    .select('id')
    .eq('id', user.id)
    .single()

  const admin = createAdminClient()

  // Insert message optimistically with status 'sending'
  const { data: msgRow, error: insertErr } = await admin
    .from('hub_sms_messages')
    .insert({
      company_id: contact.company_id,
      contact_id: contact.id,
      direction: 'outbound',
      body: message.trim(),
      sent_by: hubUser?.id ?? null,
      captivated_sent: false,
      status: 'sending',
    })
    .select()
    .single()

  if (insertErr || !msgRow) {
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
  }

  // Format phone for Captivated: needs E.164 (+1XXXXXXXXXX) or 10-digit
  const rawPhone = contact.phone.replace(/\D/g, '')
  const captivatedPhone = rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`

  let captivatedSent = false
  let finalStatus = 'failed'

  try {
    const result = await callHeroesTool('send_text', {
      phone: captivatedPhone,
      message: message.trim(),
    })
    // callHeroesTool returns a string; any non-error result means success
    captivatedSent = !result.toLowerCase().includes('error')
    finalStatus = captivatedSent ? 'sent' : 'failed'
  } catch {
    finalStatus = 'failed'
  }

  // Update message with actual send result
  await admin
    .from('hub_sms_messages')
    .update({ captivated_sent: captivatedSent, status: finalStatus })
    .eq('id', msgRow.id)

  return NextResponse.json({
    ...msgRow,
    captivated_sent: captivatedSent,
    status: finalStatus,
  })
}
