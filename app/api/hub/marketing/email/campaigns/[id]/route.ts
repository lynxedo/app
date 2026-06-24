import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'

const DETAIL_SELECT =
  `id, name, subject, body_html, status, recipient_count, sent_count, failed_count,
   skipped_count, throttle_per_min, template_id, segment_id, scheduled_at, started_at,
   completed_at, last_error, created_by, created_at`

// GET /api/hub/marketing/email/campaigns/[id] — one campaign + a recent recipient sample.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('email_campaigns')
    .select(DETAIL_SELECT)
    .eq('company_id', access.companyId)
    .eq('id', id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: sample } = await admin
    .from('email_campaign_recipients')
    .select('email, status, error_message, processed_at')
    .eq('campaign_id', id)
    .order('processed_at', { ascending: false, nullsFirst: false })
    .limit(12)

  // Engagement funnel from email_events (Session 5). service_role-only RPC; the
  // company check above is the access gate. Returns zeros until webhook events
  // start landing (after the Resend webhook is wired at prod cutover).
  const { data: statRows } = await admin.rpc('email_campaign_stats', { p_campaign_id: id })
  const s = Array.isArray(statRows) ? statRows[0] : statRows
  const stats = {
    delivered: Number(s?.delivered ?? 0),
    opened: Number(s?.opened ?? 0),
    clicked: Number(s?.clicked ?? 0),
    bounced: Number(s?.bounced ?? 0),
    complained: Number(s?.complained ?? 0),
    unsubscribed: Number(s?.unsubscribed ?? 0),
  }

  return NextResponse.json({ campaign, sample: sample ?? [], stats })
}

// DELETE — cancel an in-flight campaign (stop the drainer) or remove a finished one.
// queued/processing  -> mark canceled + flip remaining queued recipients to skipped
// complete/canceled  -> hard delete (cascade removes recipients)
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('email_campaigns')
    .select('id, status')
    .eq('company_id', access.companyId)
    .eq('id', id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (campaign.status === 'queued' || campaign.status === 'processing') {
    await admin
      .from('email_campaign_recipients')
      .update({ status: 'skipped', error_message: 'campaign canceled', processed_at: new Date().toISOString() })
      .eq('campaign_id', id)
      .eq('status', 'queued')
    // Recount so the totals stay honest after canceling.
    const { data: counts } = await admin
      .from('email_campaign_recipients')
      .select('status')
      .eq('campaign_id', id)
    const tally = (s: string) => (counts ?? []).filter((r) => r.status === s).length
    await admin
      .from('email_campaigns')
      .update({
        status: 'canceled',
        completed_at: new Date().toISOString(),
        sent_count: tally('sent'),
        failed_count: tally('failed'),
        skipped_count: tally('skipped'),
      })
      .eq('id', id)
    return NextResponse.json({ canceled: true })
  }

  await admin.from('email_campaigns').delete().eq('id', id)
  return NextResponse.json({ deleted: true })
}
