import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'

// Friendly labels for the department prefixes the team uses in Jobber line-item
// names. Anything not listed falls back to the raw code.
const DEPT_LABELS: Record<string, string> = {
  WF: 'Weed & Fert',
  IR: 'Irrigation',
  PW: 'Pet Waste',
  MO: 'Mosquito',
  LD: 'Landscape',
}

// GET /api/hub/marketing/email/line-items — the distinct JOB line items for the
// segment builder's line-item pickers: departments (WF/IR/PW/…) and specific
// line-item names, each with a usage count. Job-only so the same service listed
// under a job + visit + invoice isn't triple-counted.
export async function GET() {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('email_job_line_item_options', { p_company_id: access.companyId })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const depts: { value: string; label: string; uses: number }[] = []
  const names: { value: string; uses: number }[] = []
  for (const row of (data ?? []) as { kind: string; value: string; uses: number }[]) {
    if (!row.value) continue
    if (row.kind === 'dept') depts.push({ value: row.value, label: DEPT_LABELS[row.value] || row.value, uses: Number(row.uses) })
    else if (row.kind === 'name') names.push({ value: row.value, uses: Number(row.uses) })
  }
  return NextResponse.json({ depts, names })
}
