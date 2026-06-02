import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/txt/numbers — list this company's Txt phone numbers so the
// per-conversation override picker in TxtConversationView can render the
// dropdown. RLS on txt_phone_numbers already enforces same-company; we
// just need the auth check to fail loud rather than return an empty list.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('txt_phone_numbers')
    .select('id, twilio_number, label, is_default')
    .order('is_default', { ascending: false })
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ numbers: data || [] })
}
