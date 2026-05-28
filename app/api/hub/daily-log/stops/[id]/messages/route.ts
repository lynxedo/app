import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function authResolve(stopId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: 'Profile not found', status: 404 as const }

  const admin = createAdminClient()
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, daily_log_entries!inner(company_id)')
    .eq('id', stopId)
    .single()
  if (!stop) return { error: 'Stop not found', status: 404 as const }

  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return { error: 'Stop not found', status: 404 as const }
  }
  return { admin, stop, userId: user.id, companyId: profile.company_id }
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin } = resolved

  const { data: messages, error } = await admin
    .from('daily_log_stop_messages')
    .select('id, content, created_at, user:hub_users!user_id(id, display_name, avatar_url)')
    .eq('stop_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages: messages ?? [] })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, userId, companyId } = resolved

  const body = await request.json().catch(() => ({})) as { content?: unknown }
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content || content.length > 5000) {
    return NextResponse.json({ error: 'content must be 1–5000 characters' }, { status: 400 })
  }

  const { data: inserted, error } = await admin
    .from('daily_log_stop_messages')
    .insert({ stop_id: id, company_id: companyId, user_id: userId, content })
    .select('id, content, created_at, user:hub_users!user_id(id, display_name, avatar_url)')
    .single()

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }
  return NextResponse.json({ message: inserted })
}
