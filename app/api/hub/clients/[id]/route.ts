import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [contactResult, messagesResult] = await Promise.all([
    supabase
      .from('hub_contacts')
      .select('id, name, phone, email, jobber_client_id, do_not_text, notes, created_at, updated_at')
      .eq('id', id)
      .single(),
    supabase
      .from('hub_sms_messages')
      .select('id, direction, body, status, captivated_sent, created_at, sent_by, sender:hub_users!sent_by (id, display_name)')
      .eq('contact_id', id)
      .order('created_at', { ascending: true })
      .limit(200),
  ])

  if (contactResult.error || !contactResult.data) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  return NextResponse.json({
    contact: contactResult.data,
    messages: messagesResult.data ?? [],
  })
}
