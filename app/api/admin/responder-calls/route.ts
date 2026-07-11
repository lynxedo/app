import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('responder_calls')
    .select('id, call_sid, from_number, called_at, has_voicemail, text_sent, email_sent, template_used, error_message')
    .eq('company_id', auth.company_id!)
    .order('called_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data ?? [])
}
