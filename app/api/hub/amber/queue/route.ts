import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { amberActionLabels, isAmberApprover } from '@/lib/hub-actions/amber'
import { AMBER_QUEUE_COLUMNS, expireStaleAmberItems, type AmberQueueRow } from '@/lib/hub-actions/amber-queue'

// Amber's approval queue — what she wants to do, waiting for a person.
//
// Gated on can_admin_ai, the same as the /hub/amber screen it renders on. Seeing
// the queue and deciding it are separate: only the company's approvers (Admin →
// AI → Amber's account) can approve or reject — see ./[id]/route.ts.

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const companyId = auth.company_id

  await expireStaleAmberItems(admin, companyId)

  const [{ data: pending }, { data: recent }, canApprove] = await Promise.all([
    admin
      .from('amber_queue')
      .select(AMBER_QUEUE_COLUMNS)
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100),
    admin
      .from('amber_queue')
      .select(AMBER_QUEUE_COLUMNS)
      .eq('company_id', companyId)
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20),
    isAmberApprover(admin, companyId, auth.user.id),
  ])

  const rows = [...((pending || []) as AmberQueueRow[]), ...((recent || []) as AmberQueueRow[])]
  const deciderIds = [...new Set(rows.map((r) => r.decided_by).filter((x): x is string => !!x))]
  const names: Record<string, string> = {}
  if (deciderIds.length) {
    const { data } = await admin.from('hub_users').select('id, display_name').in('id', deciderIds)
    for (const u of (data || []) as Array<{ id: string; display_name: string | null }>) names[u.id] = u.display_name || 'Someone'
  }

  return NextResponse.json({
    pending: pending ?? [],
    recent: recent ?? [],
    canApprove,
    actions: amberActionLabels(),
    names,
  })
}
