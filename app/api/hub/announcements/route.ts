import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type AnnType = 'announcement' | 'shout_out'
const TYPES: readonly AnnType[] = ['announcement', 'shout_out']

type RawRow = {
  id: string
  content: string
  created_at: string
  expires_at: string
  type: AnnType
  archived_at: string | null
  edited_at: string | null
  created_by: string
  created_by_user: { display_name: string } | { display_name: string }[] | null
  reactions: { announcement_id: string; user_id: string; emoji: string }[]
}

function normalize(row: RawRow) {
  const created_by_user = Array.isArray(row.created_by_user) ? row.created_by_user[0] : row.created_by_user
  return { ...row, created_by_user }
}

// GET returns the latest active row of EACH type as a flat array.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const nowIso = new Date().toISOString()

  // Pull the latest non-expired, non-archived row per type.
  const results = await Promise.all(
    TYPES.map(t =>
      supabase
        .from('hub_announcements')
        .select(`
          id, content, created_at, expires_at, type, archived_at, edited_at, created_by,
          created_by_user:hub_users!created_by (display_name),
          reactions:announcement_reactions (announcement_id, user_id, emoji)
        `)
        .eq('type', t)
        .is('archived_at', null)
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    )
  )

  const active = results
    .map(r => (r.data ? normalize(r.data as unknown as RawRow) : null))
    .filter((x): x is ReturnType<typeof normalize> => x !== null)

  return NextResponse.json({ active })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_post_shout_outs')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const isAdmin = profile.role === 'admin'

  const body = await request.json()
  const content: string = body.content
  const expires_at: string = body.expires_at
  const type: AnnType = body.type === 'shout_out' ? 'shout_out' : 'announcement'

  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })
  if (!expires_at) return NextResponse.json({ error: 'expires_at required' }, { status: 400 })

  if (type === 'announcement' && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (type === 'shout_out' && !isAdmin && !profile.can_post_shout_outs) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Auto-archive any currently active row of the SAME type for this company.
  const nowIso = new Date().toISOString()
  await supabase
    .from('hub_announcements')
    .update({ archived_at: nowIso })
    .eq('company_id', profile.company_id)
    .eq('type', type)
    .is('archived_at', null)
    .gt('expires_at', nowIso)

  const { data, error } = await supabase
    .from('hub_announcements')
    .insert({
      company_id: profile.company_id,
      content: content.trim(),
      created_by: user.id,
      expires_at,
      type,
    })
    .select('id, content, created_at, expires_at, type, archived_at, edited_at, created_by')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
