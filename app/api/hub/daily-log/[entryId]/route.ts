import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyDailyLogComplete } from '@/lib/daily-log-notify'

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

  if ('secondary_tech_user_ids' in body) {
    // Need the primary to validate
    const { data: existing } = await supabase
      .from('daily_log_entries')
      .select('tech_user_id')
      .eq('id', entryId)
      .single()
    if (!existing) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    const result = normalizeSecondaries(body.secondary_tech_user_ids, existing.tech_user_id)
    if (result instanceof Error) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }
    updates.secondary_tech_user_ids = result
  }

  const { data, error } = await supabase
    .from('daily_log_entries')
    .update(updates)
    .eq('id', entryId)
    .select('id, office_notes, route_sheet_url, route_sheet_name, secondary_tech_user_ids, completed_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If the entry is already complete and a content field changed, re-fire the DM
  const contentChanged =
    'office_notes' in body ||
    'route_sheet_url' in body ||
    'route_sheet_name' in body ||
    'secondary_tech_user_ids' in body
  if (data?.completed_at && contentChanged) {
    notifyDailyLogComplete(entryId).catch((err) =>
      console.error('[daily-log] re-notify on edit failed:', err),
    )
  }

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

function normalizeSecondaries(input: unknown, primaryId: string): string[] | Error {
  if (input == null) return []
  if (!Array.isArray(input)) return new Error('secondary_tech_user_ids must be an array')
  const ids = input.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (ids.includes(primaryId)) return new Error('Primary tech cannot also be a secondary tech')
  const unique = [...new Set(ids)]
  if (unique.length !== ids.length) return new Error('Duplicate secondary techs')
  return unique
}
