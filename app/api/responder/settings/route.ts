import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // No ID filter needed — RLS scopes this to the user's company automatically
  const { data, error } = await supabase
    .from('responder_settings')
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const allowed = [
    'is_active', 'twilio_phone_number', 'business_days',
    'business_hours_start', 'business_hours_end',
    'business_hours_template', 'afterhours_template',
    'voicemail_greeting', 'notification_emails',
  ]

  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  // No ID filter needed — RLS scopes this to the user's company automatically
  const { data, error } = await supabase
    .from('responder_settings')
    .update(update)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
