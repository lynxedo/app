import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'

type HubUserLite = { id: string; display_name: string; avatar_url: string | null }

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date') // YYYY-MM-DD
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

  const { data: entries, error } = await supabase
    .from('daily_log_entries')
    .select(`
      id, log_date, office_notes, route_sheet_url, route_sheet_name, created_at,
      secondary_tech_user_ids, completed_at, completed_by, closed_at, closed_by,
      tech:hub_users!tech_user_id(id, display_name, avatar_url),
      creator:hub_users!created_by(id, display_name),
      completer:hub_users!completed_by(id, display_name),
      closer:hub_users!closed_by(id, display_name),
      updates:daily_log_updates(id, content, media_urls, created_at, created_by, creator:hub_users!created_by(id, display_name, avatar_url), reactions:daily_log_update_reactions(user_id, emoji)),
      subscribers:daily_log_subscribers(user_id)
    `)
    .eq('company_id', profile.company_id)
    .eq('log_date', date)
    .is('deleted_at', null) // DL3 — hide soft-deleted entries
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolve secondary tech display info in one batch
  const secondaryIds = new Set<string>()
  for (const e of entries ?? []) {
    for (const id of (e.secondary_tech_user_ids ?? []) as string[]) secondaryIds.add(id)
  }
  const techMap = new Map<string, HubUserLite>()
  if (secondaryIds.size > 0) {
    const { data: techs } = await supabase
      .from('hub_users')
      .select('id, display_name, avatar_url')
      .in('id', [...secondaryIds])
    for (const t of (techs ?? []) as HubUserLite[]) techMap.set(t.id, t)
  }

  const sorted = (entries ?? []).map(e => ({
    ...e,
    updates: [...(e.updates ?? [])].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
    subscriber_ids: (e.subscribers ?? []).map((s: { user_id: string }) => s.user_id),
    subscribers: undefined,
    secondary_techs: ((e.secondary_tech_user_ids ?? []) as string[])
      .map(id => techMap.get(id))
      .filter((t): t is HubUserLite => Boolean(t)),
  }))

  return NextResponse.json({ entries: sorted })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { log_date, tech_user_id, office_notes, secondary_tech_user_ids } = await request.json()
  if (!log_date || !tech_user_id) {
    return NextResponse.json({ error: 'log_date and tech_user_id required' }, { status: 400 })
  }

  const secondaries = normalizeSecondaries(secondary_tech_user_ids, tech_user_id)
  if (secondaries instanceof Error) {
    return NextResponse.json({ error: secondaries.message }, { status: 400 })
  }

  const { data: entry, error } = await supabase
    .from('daily_log_entries')
    .insert({
      company_id: profile.company_id,
      log_date,
      tech_user_id,
      secondary_tech_user_ids: secondaries,
      office_notes: office_notes?.trim() || null,
      created_by: user.id,
    })
    .select(`
      id, log_date, office_notes, route_sheet_url, route_sheet_name, created_at,
      secondary_tech_user_ids, completed_at, completed_by, closed_at, closed_by,
      tech:hub_users!tech_user_id(id, display_name, avatar_url),
      creator:hub_users!created_by(id, display_name)
    `)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'An entry for this tech already exists for this date' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-subscribe the creator
  await supabase
    .from('daily_log_subscribers')
    .insert({ entry_id: entry.id, user_id: user.id })
    .select()

  // Non-blocking: notify the assigned tech(s) that they have a new daily log
  ;(async () => {
    try {
      const admin = createAdminClient()
      const { data: senderRow } = await admin.from('hub_users').select('display_name').eq('id', user.id).single()
      const senderName = senderRow?.display_name ?? 'Someone'
      const recipientIds = [tech_user_id, ...secondaries].filter(id => id !== user.id)
      if (recipientIds.length > 0) {
        await sendHubPush(recipientIds, {
          title: `${senderName} added a daily log for ${log_date}`,
          body: office_notes?.trim() ? office_notes.trim().slice(0, 120) : 'You have a new daily log entry.',
          url: '/hub/daily-log',
        })
      }
    } catch (err) {
      console.error('[daily-log] new-entry push failed:', (err as Error).message)
    }
  })()

  // Resolve secondary tech display info for the response
  let secondaryTechs: HubUserLite[] = []
  if (secondaries.length > 0) {
    const { data: techs } = await supabase
      .from('hub_users')
      .select('id, display_name, avatar_url')
      .in('id', secondaries)
    const techMap = new Map<string, HubUserLite>(
      ((techs ?? []) as HubUserLite[]).map(t => [t.id, t]),
    )
    secondaryTechs = secondaries
      .map(id => techMap.get(id))
      .filter((t): t is HubUserLite => Boolean(t))
  }

  return NextResponse.json(
    { ...entry, updates: [], subscriber_ids: [user.id], secondary_techs: secondaryTechs },
    { status: 201 },
  )
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
