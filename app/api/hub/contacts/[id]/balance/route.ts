import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { denyWithoutGrant } from '@/lib/company-auth'
import { companyJobberUserId, jobberGraphQLPatient } from '@/lib/jobber'

// GET /api/hub/contacts/:id/balance — the customer's balance, read LIVE from
// Jobber when the customer file opens (Work Orders PRD Phase 3, §6.3).
//
// Our mirror's clients.balance goes stale: a payment fires no CLIENT_UPDATE
// webhook, so a customer who paid keeps showing what they owed (Oct 5 2026 dry
// run: 3 of 10 spot-checked customers stale — paid in Jobber, still owing here).
// One small `client { balance }` read fixes it; the fresh value is written back
// to the mirror so lists and reports catch up too. If Jobber can't be reached
// the mirror value comes back with `live: false` and when it was last synced,
// and the card says so rather than passing it off as current.
//
// Same gate as the customer file (can_access_hub, same company).

const QUERY = `query CustomerFileBalance($id: EncodedId!) { client(id: $id) { id balance } }`
const LIVE_TIMEOUT_MS = 8000

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await denyWithoutGrant(supabase, user.id, 'can_access_hub')
  if (denied) return denied
  const { data: profile } = await supabase.from('user_profiles').select('company_id').eq('id', user.id).single()
  const companyId = profile?.company_id as string | undefined
  if (!companyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: contact } = await admin
    .from('txt_contacts').select('id, company_id, jobber_client_id').eq('id', contactId).maybeSingle()
  if (!contact || contact.company_id !== companyId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const clientId = contact.jobber_client_id as string | null
  if (!clientId) return NextResponse.json({ error: 'This contact has no Jobber account' }, { status: 404 })

  const { data: mirror } = await admin
    .from('clients')
    .select('id, balance, last_synced_at')
    .eq('company_id', companyId)
    .eq('external_id', clientId)
    .is('deleted_at', null)
    .maybeSingle()
  const mirrorBalance = mirror?.balance != null ? Number(mirror.balance) : null
  const fallback = (reason: string) => NextResponse.json({
    live: false,
    balance: mirrorBalance,
    syncedAt: (mirror?.last_synced_at as string | null) ?? null,
    reason,
  })

  const jobberUser = await companyJobberUserId(companyId, user.id)
  if (!jobberUser) return fallback('Jobber isn’t connected')

  let live: number | null = null
  try {
    const res = await Promise.race([
      jobberGraphQLPatient<{ data?: { client?: { id: string; balance: number | null } | null } }>(jobberUser, QUERY, { id: clientId }, [1500]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), LIVE_TIMEOUT_MS)),
    ])
    const b = res?.data?.client?.balance
    if (typeof b !== 'number' || !Number.isFinite(b)) return fallback('Jobber didn’t return a balance')
    live = b
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return fallback(/timeout/i.test(msg) ? 'Jobber took too long to answer' : /throttled/i.test(msg) ? 'Jobber is busy' : 'Couldn’t reach Jobber')
  }

  const checkedAt = new Date().toISOString()
  // Keep the mirror honest for everything else that reads it (lists, reports).
  if (mirror?.id && (mirrorBalance == null || Math.abs(mirrorBalance - live) >= 0.005)) {
    await admin.from('clients').update({ balance: live, updated_at: checkedAt }).eq('id', mirror.id)
  }
  return NextResponse.json({ live: true, balance: live, checkedAt, previous: mirrorBalance })
}
