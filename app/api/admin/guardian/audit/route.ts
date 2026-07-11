import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 100

export async function GET(request: Request) {
  const check = await requireAdminArea('ai')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const includeTest = searchParams.get('is_test') === 'true'
  const limitRaw = parseInt(searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, MAX_LIMIT)
    : DEFAULT_LIMIT

  const admin = createAdminClient()
  let query = admin
    .from('guardian_audit')
    .select(`
      id, created_at, user_id, question, answer, model, tools_called,
      web_searches_used, input_tokens, output_tokens, is_test, guardian_tier,
      room_id, conversation_id
    `)
    .eq('company_id', check.company_id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!includeTest) query = query.eq('is_test', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich with display_name for the audit table. One batched lookup so this
  // stays cheap even at 200 rows.
  const userIds = Array.from(
    new Set((data ?? []).map((r: { user_id: string | null }) => r.user_id).filter((v): v is string => !!v))
  )
  let userMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: users } = await admin
      .from('hub_users')
      .select('id, display_name')
      .in('id', userIds)
    for (const u of (users ?? []) as Array<{ id: string; display_name: string | null }>) {
      userMap[u.id] = u.display_name ?? ''
    }
  }

  const enriched = (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    user_display_name: row.user_id ? userMap[row.user_id as string] ?? null : null,
  }))

  return NextResponse.json({ rows: enriched })
}
