import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('board_item_attachments')
    .select('id, storage_path, filename, mime_type, size_bytes, width_px, height_px, created_at, uploaded_by, uploader:hub_users!uploaded_by(display_name)')
    .eq('board_item_id', itemId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ attachments: data ?? [] })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { storage_path, filename, mime_type, size_bytes, width_px, height_px } = await request.json()
  if (!storage_path || !filename) return NextResponse.json({ error: 'storage_path and filename required' }, { status: 400 })

  const { data, error } = await supabase
    .from('board_item_attachments')
    .insert({
      board_item_id: itemId,
      company_id: profile.company_id,
      uploaded_by: user.id,
      storage_path,
      filename,
      mime_type: mime_type ?? 'application/octet-stream',
      size_bytes: size_bytes ?? 0,
      width_px: width_px ?? null,
      height_px: height_px ?? null,
    })
    .select('id, storage_path, filename, mime_type, size_bytes, width_px, height_px, created_at, uploaded_by, uploader:hub_users!uploaded_by(display_name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const attachmentId = url.searchParams.get('attachmentId')
  if (!attachmentId) return NextResponse.json({ error: 'attachmentId required' }, { status: 400 })

  const { error } = await supabase
    .from('board_item_attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('board_item_id', itemId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
