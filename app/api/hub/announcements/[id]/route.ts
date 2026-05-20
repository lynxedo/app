import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function loadActor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, profile: null }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return { supabase, user, profile }
}

// Edit content of an active announcement/shout-out.
// Allowed for: admins, or the original poster.
// expires_at and created_at are preserved (per Session 33 decision).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, user, profile } = await loadActor()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: row, error: loadErr } = await supabase
    .from('hub_announcements')
    .select('id, created_by, archived_at, expires_at')
    .eq('id', id)
    .maybeSingle()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = profile?.role === 'admin'
  const isAuthor = row.created_by === user.id
  if (!isAdmin && !isAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { content } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const { data, error } = await supabase
    .from('hub_announcements')
    .update({ content: content.trim(), edited_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, content, created_at, expires_at, type, archived_at, edited_at, created_by')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE archives by default (soft) — admins only.
// ?hard=1 forces a real delete (kept for admin cleanup of obviously bad posts).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, user, profile } = await loadActor()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const hard = new URL(request.url).searchParams.get('hard') === '1'
  if (hard) {
    const { error } = await supabase.from('hub_announcements').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, mode: 'deleted' })
  }

  const { error } = await supabase
    .from('hub_announcements')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode: 'archived' })
}
