import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocal } from '@/lib/dispatch'

// Days since each stop's last completed visit (the Advanced optimizer's pin
// label, brought to Dispatch). Keyed by VISIT id, answered from Hub's copy of
// Jobber — one query instead of one Jobber call per job: find each visit's job,
// then that job's latest completed visit before today.

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const body = await request.json().catch(() => null) as { visitIds?: unknown } | null
  const ids = Array.isArray(body?.visitIds) ? (body!.visitIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 400) : []
  if (ids.length === 0) return NextResponse.json({ days: {} })

  const admin = createAdminClient()
  const jobOf = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('visits').select('external_id, job_id')
      .eq('company_id', auth.companyId).in('external_id', ids.slice(i, i + 200))
    for (const v of data ?? []) if (v.job_id) jobOf.set(v.external_id as string, v.job_id as string)
  }
  const jobIds = [...new Set(jobOf.values())]
  const today = todayLocal()
  const lastOf = new Map<string, string>()
  for (let i = 0; i < jobIds.length; i += 150) {
    const { data } = await admin.from('visits').select('job_id, completed_at')
      .eq('company_id', auth.companyId).in('job_id', jobIds.slice(i, i + 150))
      .not('completed_at', 'is', null).lt('completed_at', `${today}T00:00:00`)
      .order('completed_at', { ascending: false }).limit(5000)
    for (const v of data ?? []) if (!lastOf.has(v.job_id as string)) lastOf.set(v.job_id as string, (v.completed_at as string).slice(0, 10))
  }
  const days: Record<string, number | null> = {}
  const t = new Date(`${today}T12:00:00Z`).getTime()
  for (const id of ids) {
    const job = jobOf.get(id)
    const last = job ? lastOf.get(job) : undefined
    days[id] = last ? Math.round((t - new Date(`${last}T12:00:00Z`).getTime()) / 86400000) : null
  }
  return NextResponse.json({ days })
}
