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

  // The email audience is the "has an email" slice of the unified directory.
  const countWhere = async (status?: string) => {
    let q = admin.from('txt_contacts').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).is('deleted_at', null).not('email', 'is', null)
    if (status) q = q.eq('email_status', status)
    const { count } = await q
    return count ?? 0
  }

  const [total, subscribed, unsubscribed, bounced] = await Promise.all([
    countWhere(), countWhere('subscribed'), countWhere('unsubscribed'), countWhere('bounced'),
  ])
  const { count: suppressed } = await admin
    .from('email_suppressions').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
  const { count: tagCount } = await admin
    .from('contact_tags').select('id', { count: 'exact', head: true }).eq('company_id', companyId)

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
