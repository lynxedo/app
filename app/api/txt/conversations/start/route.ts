import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// POST /api/txt/conversations/start
// Body: { phone, name?, email?, jobber_client_id? }
// Returns: { conversation_id }
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const phoneE164 = toE164(body.phone || '')
  if (!phoneE164) {
    return NextResponse.json({ error: 'Invalid phone' }, { status: 400 })
  }
  const name: string = (body.name || phoneE164).trim()
  const email: string | null = body.email || null
  const notes: string | null = body.notes || null
  const jobberClientId: string | null = body.jobber_client_id || null

  const admin = createAdminClient()

  // Find or create contact
  const { data: existingContact } = await admin
    .from('txt_contacts')
    .select('id')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('phone', phoneE164)
    .maybeSingle()

  let contactId = existingContact?.id
  if (!contactId) {
    const { data: created, error: createErr } = await admin
      .from('txt_contacts')
      .insert({
        company_id: HEROES_COMPANY_ID,
        phone: phoneE164,
        phone_digits: phoneE164.replace(/\D/g, '').slice(-10),
        name,
        email,
        notes,
        jobber_client_id: jobberClientId,
        in_directory: jobberClientId != null,
      })
      .select('id')
      .single()
    if (createErr || !created) {
      return NextResponse.json({ error: createErr?.message || 'Contact insert failed' }, { status: 500 })
    }
    contactId = created.id
  } else {
    // Update name/email/notes/jobber_id if newly known
    if (name || email || notes || jobberClientId) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (name) patch.name = name
      if (email) patch.email = email
      if (notes) patch.notes = notes
      if (jobberClientId) patch.jobber_client_id = jobberClientId
      await admin.from('txt_contacts').update(patch).eq('id', contactId)
    }
  }

  // Find or create conversation (direct 1-to-1 only; groups go through
  // /api/txt/conversations/start-group).
  const { data: existingConv } = await admin
    .from('txt_conversations')
    .select('id, status')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('contact_id', contactId)
    .eq('kind', 'direct')
    .maybeSingle()

  if (existingConv) {
    if (existingConv.status === 'archived') {
      await admin
        .from('txt_conversations')
        .update({ status: 'assigned', assigned_to: user.id, archived_by: null })
        .eq('id', existingConv.id)
      // Reopening transfers ownership to whoever's restarting the thread.
      await admin
        .from('txt_conversation_members')
        .delete()
        .eq('conversation_id', existingConv.id)
        .eq('role', 'owner')
      await admin.from('txt_conversation_members').insert({
        conversation_id: existingConv.id,
        user_id: user.id,
        role: 'owner',
        added_by: user.id,
      })
    }
    return NextResponse.json({ conversation_id: existingConv.id })
  }

  const { data: createdConv, error: convErr } = await admin
    .from('txt_conversations')
    .insert({
      company_id: HEROES_COMPANY_ID,
      contact_id: contactId,
      assigned_to: user.id,
      status: 'assigned',
      kind: 'direct',
    })
    .select('id')
    .single()
  if (convErr || !createdConv) {
    return NextResponse.json({ error: convErr?.message || 'Conversation insert failed' }, { status: 500 })
  }

  await admin.from('txt_conversation_members').insert({
    conversation_id: createdConv.id,
    user_id: user.id,
    role: 'owner',
    added_by: user.id,
  })

  return NextResponse.json({ conversation_id: createdConv.id })
}
