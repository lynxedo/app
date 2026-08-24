import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/* Admin-only: what the business spends per marketing channel, per month.
 *
 * There is no ad-spend feed anywhere in the platform — not from Google Ads, not from
 * Angi — so this is the only way cost per lead, cost per customer and return on ad
 * spend can exist at all. Until a row is entered the Channel Scorecard shows the
 * volume half only and says so on its face.
 *
 * `marketing_spend` has RLS on with NO policies, so it is service-role only and this
 * route is the single door — the same shape as `report_goals` and `report_access`.
 * What the company pays for leads is not something every Hub user should be able to
 * read straight off the REST API.
 */
async function getAdminContext(): Promise<{ company: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'admin' || !profile.company_id) return null
  return { company: profile.company_id as string }
}

export async function POST(request: Request) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as {
    source?: string; month?: string; amount?: number | string; notes?: string | null
  }
  const source = String(body.source || '').trim()
  const month = String(body.month || '').trim()
  const amount = Number(body.amount)
  const notes = String(body.notes ?? '').trim() || null

  if (!source) return NextResponse.json({ error: 'Pick a channel' }, { status: 400 })
  // Accepts either a month input ("2026-08") or a full date, and always stores the
  // first of the month — the table has a CHECK that enforces it, so a stray day
  // would be a 500 rather than a quiet wrong row.
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(month)
  if (!m) return NextResponse.json({ error: 'Pick a month' }, { status: 400 })
  const periodStart = `${m[1]}-${m[2]}-01`
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'Spend must be zero or more' }, { status: 400 })
  }

  const admin = createAdminClient()

  /* ⚠ The channel must be one of the tenant's own master sources. Not cosmetic: the
   * scorecard joins spend to lead/revenue rows on this exact string, so a typo would
   * store a real cost against a channel that can never match anything — money entered,
   * silently counted nowhere, and no error to notice. */
  const { data: master, error: mErr } = await admin
    .from('lead_sources_master')
    .select('master_source')
    .eq('company_id', ctx.company)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })
  const exact = (master ?? []).find(r => String(r.master_source).toLowerCase() === source.toLowerCase())
  if (!exact) {
    return NextResponse.json({ error: `"${source}" is not one of your lead sources` }, { status: 400 })
  }

  const { error } = await admin
    .from('marketing_spend')
    .upsert(
      {
        company_id: ctx.company,
        // Stored in the master list's own spelling, so re-entering the same channel
        // with different capitals updates the row rather than creating a rival one.
        source: exact.master_source,
        period_start: periodStart,
        amount,
        notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,source,period_start' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, source: exact.master_source, period_start: periodStart })
}

export async function DELETE(request: Request) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = String(new URL(request.url).searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const admin = createAdminClient()
  // Scoped to this admin's company: an id alone is not authorization.
  const { error } = await admin
    .from('marketing_spend')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.company)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
