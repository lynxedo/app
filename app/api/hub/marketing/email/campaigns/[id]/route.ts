import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import {
  normalizeAudienceSpec,
  resolveCampaignAudience,
  buildCampaignContent,
  enqueueCampaignRecipients,
  describeAudience,
  type CampaignRecipient,
} from '@/lib/email-campaigns'

const THROTTLE_MIN = 1
const THROTTLE_MAX = 120

const DETAIL_SELECT =
  `id, name, subject, body_html, design, audience, status, recipient_count, sent_count, failed_count,
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

// PATCH — edit a DRAFT campaign, or send it. Only drafts are editable; queued /
// processing / complete / canceled campaigns are immutable here.
//   body { ...same audience+content fields as POST, send? }
//   send !== true → save the draft (content + audience spec), stay 'draft'
//   send === true → resolve the audience FRESH, snapshot, enqueue, flip to 'queued'
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('email_campaigns')
    .select('id, status')
    .eq('company_id', access.companyId)
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Only drafts can be edited. This campaign has already been sent.' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const send = body.send === true
  const name = String(body.name || '').trim()
  let throttle = Number(body.throttle_per_min)
  throttle = Number.isFinite(throttle) ? Math.min(THROTTLE_MAX, Math.max(THROTTLE_MIN, Math.round(throttle))) : 60

  let scheduledAt: string | null = null
  if (typeof body.scheduled_at === 'string' && body.scheduled_at) {
    const t = Date.parse(body.scheduled_at)
    if (Number.isFinite(t) && t > Date.now() + 30_000) scheduledAt = new Date(t).toISOString()
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  const content = await buildCampaignContent(admin, access.companyId, body, baseUrl)
  if (!content.ok) return NextResponse.json({ error: content.error }, { status: content.status })

  const spec = normalizeAudienceSpec(body)
  const { data: segRows } = spec.segment_ids?.length
    ? await admin.from('email_segments').select('name').eq('company_id', access.companyId).in('id', spec.segment_ids)
    : { data: [] as { name: string }[] }
  const autoName = `${content.sourceName} → ${describeAudience(spec, (segRows ?? []).map((s) => s.name))}`
  const usedSegmentId = !spec.everyone && spec.segment_ids?.length === 1 ? spec.segment_ids[0] : null

  // ── Save (stay draft) ───────────────────────────────────────────────────────
  if (!send) {
    const { error } = await admin
      .from('email_campaigns')
      .update({
        template_id: content.templateId,
        segment_id: usedSegmentId,
        name: name || autoName,
        subject: content.subject,
        design: content.design,
        body_html: content.bodyHtml,
        audience: spec,
        throttle_per_min: throttle,
        scheduled_at: scheduledAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ campaign_id: id, draft: true })
  }

  // ── Send: validate, resolve fresh, snapshot, enqueue, flip to queued ─────────
  if (!content.design.blocks.length) return NextResponse.json({ error: 'Add some content to the email before sending.' }, { status: 400 })
  if (!content.subject) return NextResponse.json({ error: 'Add a subject line before sending.' }, { status: 400 })

  const audience: CampaignRecipient[] = await resolveCampaignAudience(admin, access.companyId, spec)
  if (!audience.length) {
    return NextResponse.json({ error: 'No subscribed, emailable recipients match this audience right now.' }, { status: 400 })
  }

  const { error: uErr } = await admin
    .from('email_campaigns')
    .update({
      template_id: content.templateId,
      segment_id: usedSegmentId,
      name: name || autoName,
      subject: content.subject,
      design: content.design,
      body_html: content.bodyHtml,
      audience: spec,
      status: 'queued',
      recipient_count: audience.length,
      throttle_per_min: throttle,
      scheduled_at: scheduledAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'draft') // guard against a concurrent send
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  const enq = await enqueueCampaignRecipients(admin, id, audience)
  if (!enq.ok) return NextResponse.json({ error: enq.error }, { status: 500 })

  const { data: settings } = await admin
    .from('email_settings')
    .select('from_email, physical_address, domain_verified')
    .eq('company_id', access.companyId)
    .maybeSingle()
  const warnings: string[] = []
  if (!settings?.from_email) warnings.push('No sending address is configured (Admin → Email Marketing).')
  if (!settings?.domain_verified) warnings.push('The sending domain is not verified yet — emails will not deliver until it is.')
  if (!settings?.physical_address) warnings.push('No physical mailing address is set — required by CAN-SPAM. Add it in Admin → Email Marketing.')

  return NextResponse.json({ campaign_id: id, recipient_count: audience.length, scheduled_at: scheduledAt, warnings })
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
