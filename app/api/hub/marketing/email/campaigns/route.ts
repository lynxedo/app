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
import { resolveIdentityRow, validIdentityId } from '@/lib/email-identities'

const LIST_SELECT =
  `id, name, subject, status, recipient_count, sent_count, failed_count, skipped_count,
   throttle_per_min, template_id, segment_id, identity_id, scheduled_at, started_at, completed_at,
   last_error, created_by, created_at`

const THROTTLE_MIN = 1
const THROTTLE_MAX = 120 // Resend default rate limit is ~2 req/s = 120/min

// GET /api/hub/marketing/email/campaigns — recent campaigns for the company.
export async function GET() {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_campaigns')
    .select(LIST_SELECT)
    .eq('company_id', access.companyId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaigns: data ?? [] })
}

// POST — create a campaign. body:
//   { template_id?, design?, subject?, name?,
//     everyone?, segment_ids?[], contact_ids?[], extra_emails?[], excluded_ids?[],
//     scheduled_at?(ISO), throttle_per_min?, save_as_draft? }
//
// Two modes:
//   • save_as_draft → store content + the audience SPEC (no recipients enqueued);
//     reopen/edit/send later. Audience is resolved fresh at send time.
//   • otherwise     → resolve the combined, de-duplicated audience now, snapshot
//     the rendered subject + HTML, and enqueue recipients (status 'queued').
//
// The audience can COMBINE everyone/segments/picked-contacts/typed-addresses; the
// resolver merges them de-duplicated by email so nobody is sent the same campaign
// twice. The HTML snapshot freezes the content (merge tokens intact, filled
// per-recipient at send) so later template edits never change a queued/sent
// campaign — same principle as txt_broadcasts. Suppression is re-checked per
// recipient at send time in the process cron.
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const saveAsDraft = body.save_as_draft === true
  const name = String(body.name || '').trim()
  let throttle = Number(body.throttle_per_min)
  throttle = Number.isFinite(throttle) ? Math.min(THROTTLE_MAX, Math.max(THROTTLE_MIN, Math.round(throttle))) : 60

  // Optional schedule. A past/invalid date => send asap (null).
  let scheduledAt: string | null = null
  if (typeof body.scheduled_at === 'string' && body.scheduled_at) {
    const t = Date.parse(body.scheduled_at)
    if (Number.isFinite(t) && t > Date.now() + 30_000) scheduledAt = new Date(t).toISOString()
  }

  const admin = createAdminClient()

  // Which sending identity (From/domain) this campaign uses. Null = the company
  // default is resolved at send time. Validated against this company's identities.
  const identityId = await validIdentityId(admin, access.companyId, typeof body.identity_id === 'string' ? body.identity_id : null)

  // Absolute origin for image URLs. NEXT_PUBLIC_APP_URL is the public domain;
  // request.url's origin is the proxy-internal address behind the Cloudflare
  // tunnel (e.g. localhost:3000), which Gmail's image proxy can't fetch.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')

  const content = await buildCampaignContent(admin, access.companyId, body, baseUrl)
  if (!content.ok) return NextResponse.json({ error: content.error }, { status: content.status })

  const spec = normalizeAudienceSpec(body)

  // Friendly fallback name from the audience.
  const { data: segRows } = spec.segment_ids?.length
    ? await admin.from('email_segments').select('name').eq('company_id', access.companyId).in('id', spec.segment_ids)
    : { data: [] as { name: string }[] }
  const segmentNames = (segRows ?? []).map((s) => s.name)
  const autoName = `${content.sourceName} → ${describeAudience(spec, segmentNames)}`
  const usedSegmentId = !spec.everyone && spec.segment_ids?.length === 1 ? spec.segment_ids[0] : null

  // ── Draft: persist content + audience spec, enqueue nothing. ────────────────
  if (saveAsDraft) {
    const { data: draft, error: dErr } = await admin
      .from('email_campaigns')
      .insert({
        company_id: access.companyId,
        created_by: access.userId,
        template_id: content.templateId,
        segment_id: usedSegmentId,
        identity_id: identityId,
        name: name || autoName,
        subject: content.subject,
        design: content.design,
        body_html: content.bodyHtml,
        audience: spec,
        status: 'draft',
        recipient_count: 0,
        throttle_per_min: throttle,
        scheduled_at: scheduledAt,
      })
      .select('id')
      .single()
    if (dErr || !draft) return NextResponse.json({ error: dErr?.message || 'Could not save the draft' }, { status: 500 })
    return NextResponse.json({ campaign_id: draft.id, draft: true })
  }

  // ── Send: validate, resolve audience, snapshot, enqueue. ────────────────────
  if (!content.design.blocks.length) return NextResponse.json({ error: 'Add some content to the email before sending.' }, { status: 400 })
  if (!content.subject) return NextResponse.json({ error: 'Add a subject line before sending.' }, { status: 400 })

  const audience: CampaignRecipient[] = await resolveCampaignAudience(admin, access.companyId, spec)
  if (!audience.length) {
    return NextResponse.json({ error: 'No subscribed, emailable recipients match this audience right now.' }, { status: 400 })
  }

  // Compliance / deliverability warnings (non-blocking — surfaced to the user),
  // scoped to the identity this campaign will actually send from.
  const [identityRow, { data: settings }] = await Promise.all([
    resolveIdentityRow(admin, access.companyId, identityId),
    admin.from('email_settings').select('physical_address').eq('company_id', access.companyId).maybeSingle(),
  ])
  const warnings: string[] = []
  if (!identityRow?.from_email) warnings.push('No sending address is configured (Admin → Email Marketing).')
  else if (!identityRow.domain_verified) warnings.push(`The sending domain${identityRow.sending_domain ? ` (${identityRow.sending_domain})` : ''} is not verified yet — emails will not deliver until it is.`)
  if (!settings?.physical_address) warnings.push('No physical mailing address is set — required by CAN-SPAM. Add it in Admin → Email Marketing.')

  const { data: campaign, error: cErr } = await admin
    .from('email_campaigns')
    .insert({
      company_id: access.companyId,
      created_by: access.userId,
      template_id: content.templateId,
      segment_id: usedSegmentId,
      identity_id: identityId,
      name: name || autoName,
      subject: content.subject,
      design: content.design,
      body_html: content.bodyHtml,
      audience: spec,
      status: 'queued',
      recipient_count: audience.length,
      throttle_per_min: throttle,
      scheduled_at: scheduledAt,
    })
    .select('id')
    .single()
  if (cErr || !campaign) {
    return NextResponse.json({ error: cErr?.message || 'Could not create the campaign' }, { status: 500 })
  }

  const enq = await enqueueCampaignRecipients(admin, campaign.id, audience)
  if (!enq.ok) {
    await admin.from('email_campaigns').delete().eq('id', campaign.id)
    return NextResponse.json({ error: enq.error }, { status: 500 })
  }

  return NextResponse.json({
    campaign_id: campaign.id,
    recipient_count: audience.length,
    scheduled_at: scheduledAt,
    warnings,
  })
}
