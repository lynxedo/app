import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'

// GET — enrollment monitor: who's in this automation, where, and what's next.
// Counts by status + a recent sample. Optional ?status= filter.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  // Confirm ownership before exposing enrollment rows.
  const { data: automation } = await admin
    .from('email_automations')
    .select('id')
    .eq('company_id', access.companyId)
    .eq('id', id)
    .maybeSingle()
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const statusFilter = new URL(request.url).searchParams.get('status')

  const { data: all } = await admin
    .from('email_automation_enrollments')
    .select('status')
    .eq('automation_id', id)
  const counts: Record<string, number> = { active: 0, completed: 0, exited: 0, paused: 0 }
  for (const r of all ?? []) counts[r.status] = (counts[r.status] || 0) + 1

  let q = admin
    .from('email_automation_enrollments')
    .select('id, email, first_name, last_name, current_step_index, next_run_at, status, enrolled_at, completed_at')
    .eq('automation_id', id)
    .order('enrolled_at', { ascending: false })
    .limit(50)
  if (statusFilter) q = q.eq('status', statusFilter)
  const { data: sample } = await q

  return NextResponse.json({ counts, enrollments: sample ?? [] })
}
