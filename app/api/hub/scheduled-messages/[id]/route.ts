import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { content, send_at } = body as { content?: string; send_at?: string }

  const { data: existing, error: lookupErr } = await supabase
    .from('scheduled_messages')
    .select('id, sender_id, sent_at, content, files')
    .eq('id', id)
    .single()
  if (lookupErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.sender_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (existing.sent_at) return NextResponse.json({ error: 'Already sent' }, { status: 400 })

  const patch: { content?: string; send_at?: string } = {}

  if (typeof content === 'string') {
    const trimmed = content.trim()
    const hasFiles = Array.isArray(existing.files) && existing.files.length > 0
    if (!trimmed && !hasFiles) return NextResponse.json({ error: 'content or files required' }, { status: 400 })
    patch.content = trimmed
  }

  if (typeof send_at === 'string') {
    const t = new Date(send_at)
    if (Number.isNaN(t.getTime())) return NextResponse.json({ error: 'invalid send_at' }, { status: 400 })
    if (t <= new Date()) return NextResponse.json({ error: 'send_at must be in the future' }, { status: 400 })
    patch.send_at = t.toISOString()
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { error } = await supabase.from('scheduled_messages').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing, error: lookupErr } = await supabase
    .from('scheduled_messages')
    .select('id, sender_id, sent_at')
    .eq('id', id)
    .single()
  if (lookupErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.sender_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (existing.sent_at) return NextResponse.json({ error: 'Already sent' }, { status: 400 })

  const { error } = await supabase.from('scheduled_messages').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
