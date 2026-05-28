import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/hub/social/posts?status=&account_id=
// POST /api/hub/social/posts  — create one post per selected account
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_marketing')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_marketing || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const statusFilter = url.searchParams.get('status')
  const accountFilter = url.searchParams.get('account_id')

  const admin = createAdminClient()
  let query = admin
    .from('social_posts')
    .select(`
      id, account_id, hub_file_id, caption, scheduled_at, published_at,
      fb_post_id, status, error_message, platforms, created_at,
      account:social_accounts!account_id (account_name, platform, ig_user_id),
      file:hub_files!hub_file_id (filename, storage_path, mime_type)
    `)
    .eq('company_id', profile.company_id)
    .order('scheduled_at', { ascending: false })
    .limit(200)

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  }
  if (accountFilter) {
    query = query.eq('account_id', accountFilter)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ posts: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_marketing, role')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_marketing || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as {
    account_entries?: Array<{ account_id: string; platforms: string[] }>
    hub_file_id?: string | null
    caption?: string
    scheduled_at?: string
    action?: 'draft' | 'schedule' | 'post_now'
  }

  if (!body.account_entries?.length) {
    return NextResponse.json({ error: 'At least one account required' }, { status: 400 })
  }
  if (!body.caption?.trim()) {
    return NextResponse.json({ error: 'Caption required' }, { status: 400 })
  }
  if (!body.scheduled_at) {
    return NextResponse.json({ error: 'scheduled_at required' }, { status: 400 })
  }

  const status = body.action === 'post_now' ? 'scheduled' : (body.action === 'schedule' ? 'scheduled' : 'draft')

  // Verify all accounts belong to this company
  const admin = createAdminClient()
  const accountIds = body.account_entries.map(e => e.account_id)
  const { data: accountRows } = await admin
    .from('social_accounts')
    .select('id')
    .eq('company_id', profile.company_id)
    .in('id', accountIds)

  if (!accountRows || accountRows.length !== accountIds.length) {
    return NextResponse.json({ error: 'Invalid account(s)' }, { status: 400 })
  }

  const rows = body.account_entries.map(entry => ({
    company_id: profile.company_id,
    account_id: entry.account_id,
    hub_file_id: body.hub_file_id ?? null,
    caption: body.caption!.trim(),
    scheduled_at: body.action === 'post_now' ? new Date().toISOString() : body.scheduled_at!,
    platforms: entry.platforms,
    status,
    created_by: user.id,
  }))

  const { data, error } = await admin
    .from('social_posts')
    .insert(rows)
    .select('id, account_id, status, scheduled_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ posts: data }, { status: 201 })
}
