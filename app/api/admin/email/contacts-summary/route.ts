import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// Counts for the admin Contacts panel: audience by status, suppressions, and
// the recent import history.
export async function GET() {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const companyId = check.company_id

  const countWhere = async (status?: string) => {
    let q = admin.from('email_contacts').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
    if (status) q = q.eq('status', status)
    const { count } = await q
    return count ?? 0
  }

  const [total, subscribed, unsubscribed, bounced] = await Promise.all([
    countWhere(), countWhere('subscribed'), countWhere('unsubscribed'), countWhere('bounced'),
  ])
  const { count: suppressed } = await admin
    .from('email_suppressions').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
  const { count: tagCount } = await admin
    .from('email_contact_tags').select('id', { count: 'exact', head: true })

  const { data: imports } = await admin
    .from('email_imports')
    .select('id, filename, source, list_type, total_rows, created_count, updated_count, suppressed_count, skipped_count, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({
    counts: { total, subscribed, unsubscribed, bounced, suppressed: suppressed ?? 0, tags: tagCount ?? 0 },
    imports: imports ?? [],
  })
}
