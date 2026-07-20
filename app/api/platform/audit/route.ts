import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'

// Platform super-admin audit log viewer (cross-company). Returns the 100 most-recent
// platform-admin actions, newest first, optionally filtered to one tenant via
// ?company_id=. Service-role admin client — platform_admin_audit has RLS with no policies.
//
// NOTE: the actor's email lives in auth.users, which is not exposed through the PostgREST
// JS client, so we return actor_user_id rather than actor_email. company_name is resolved
// with an in-memory Map join over companies (the codebase's Map-join pattern).

type AuditRow = {
  id: string
  actor_user_id: string | null
  action: string
  target_company_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

export async function GET(request: Request) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get('company_id')?.trim() || ''

  const admin = createAdminClient()
  try {
    let query = admin
      .from('platform_admin_audit')
      .select('id, actor_user_id, action, target_company_id, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (companyId) query = query.eq('target_company_id', companyId)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as AuditRow[]

    // Resolve company_name for every distinct target company in one read.
    const targetIds = Array.from(
      new Set(rows.map((r) => r.target_company_id).filter((v): v is string => !!v)),
    )
    const nameByCompany = new Map<string, string>()
    if (targetIds.length > 0) {
      const { data: companyRows } = await admin
        .from('companies')
        .select('id, name')
        .in('id', targetIds)
      for (const c of (companyRows ?? []) as Array<{ id: string; name: string }>) {
        nameByCompany.set(c.id, c.name)
      }
    }

    const events = rows.map((r) => ({
      id: r.id,
      action: r.action,
      target_company_id: r.target_company_id,
      detail: r.detail ?? {},
      created_at: r.created_at,
      actor_user_id: r.actor_user_id,
      company_name: r.target_company_id ? nameByCompany.get(r.target_company_id) ?? null : null,
    }))

    return NextResponse.json({ events })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
