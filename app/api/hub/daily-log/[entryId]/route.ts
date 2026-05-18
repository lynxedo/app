import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params
  const body = await request.json()
  const updates: Record<string, unknown> = {}
  if ('office_notes' in body) updates.office_notes = body.office_notes?.trim() || null
  if ('route_sheet_url' in body) updates.route_sheet_url = body.route_sheet_url
  if ('route_sheet_name' in body) updates.route_sheet_name = body.route_sheet_name

  const { data, error } = await supabase
    .from('daily_log_entries')
    .update(updates)
    .eq('id', entryId)
    .select('id, office_notes, route_sheet_url, route_sheet_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params

  const { error } = await supabase
    .from('daily_log_entries')
    .delete()
    .eq('id', entryId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
