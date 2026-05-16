import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('hub_users')
    .select('id, display_name, avatar_url, status, status_text, status_emoji, status_until')
    .eq('id', user.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const allowed = ['status', 'status_text', 'status_emoji', 'status_until']
  const update: Record<string, string | null> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key] ?? null
  }

  const { data, error } = await supabase
    .from('hub_users')
    .update(update)
    .eq('id', user.id)
    .select('id, display_name, status, status_text, status_emoji, status_until')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
