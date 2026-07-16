import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDripAccess } from '@/lib/drip-auth'

// GET — enrollment counts by status + a recent list (for the monitor modal).
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('drip_campaigns')
    .select('id')
    .eq('company_id', access.companyId)
    .eq('id', id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: rows } = await admin
    .from('drip_enrollments')
    .select('id, contact_id, phone, current_step_index, status, next_run_at, enrolled_at')
    .eq('campaign_id', id)
    .order('enrolled_at', { ascending: false })
    .limit(200)

  const counts: Record<string, number> = { active: 0, replied: 0, completed: 0, opted_out: 0, exited: 0, failed: 0 }
  for (const r of rows ?? []) counts[r.status] = (counts[r.status] || 0) + 1

  // Resolve a friendly label per enrollment (contact name → phone → "Lead").
  const contactIds = [...new Set((rows ?? []).map((r) => r.contact_id).filter(Boolean) as string[])]
  const nameById: Record<string, string> = {}
  if (contactIds.length) {
    const { data: contacts } = await admin.from('txt_contacts').select('id, name').in('id', contactIds)
    for (const c of contacts ?? []) nameById[c.id] = c.name
  }

  const enrollments = (rows ?? []).map((r) => ({
    id: r.id,
    label: (r.contact_id && nameById[r.contact_id]) || r.phone || 'Lead',
    current_step_index: r.current_step_index,
    status: r.status,
    next_run_at: r.next_run_at,
  }))

  return NextResponse.json({ counts, enrollments })
}
