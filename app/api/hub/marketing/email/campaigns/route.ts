import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { normalizeDesign, renderDesignToHtml } from '@/lib/email-blocks'
import { getEmailAudience } from '@/lib/email-contacts'
import { resolveSegment, normalizeFilter } from '@/lib/email-segments'

const LIST_SELECT =
  `id, name, subject, status, recipient_count, sent_count, failed_count, skipped_count,
   throttle_per_min, template_id, segment_id, scheduled_at, started_at, completed_at,
   last_error, created_by, created_at`

const THROTTLE_MIN = 1
const THROTTLE_MAX = 120 // Resend default rate limit is ~2 req/s = 120/min

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

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

// POST — create + enqueue a campaign. body:
//   { template_id, segment_id?(null=everyone), name?, scheduled_at?(ISO), throttle_per_min? }
//
// We snapshot the rendered subject + HTML onto the campaign (merge tokens left
// intact, filled per-recipient at send) so later edits to the template never
// change an in-flight or sent campaign — same principle as txt_broadcasts freezing
// its body. The audience comes from the segment (or everyone), already filtered to
// subscribed + non-suppressed by getEmailAudience; suppression is re-checked at
// send time in the process cron.
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const templateId = typeof body.template_id === 'string' ? body.template_id : ''
  const segmentId = typeof body.segment_id === 'string' && body.segment_id ? body.segment_id : null
  const name = String(body.name || '').trim()
  let throttle = Number(body.throttle_per_min)
  throttle = Number.isFinite(throttle) ? Math.min(THROTTLE_MAX, Math.max(THROTTLE_MIN, Math.round(throttle))) : 60

  // Optional schedule. A past/invalid date => send asap (null).
  let scheduledAt: string | null = null
  if (typeof body.scheduled_at === 'string' && body.scheduled_at) {
    const t = Date.parse(body.scheduled_at)
    if (Number.isFinite(t) && t > Date.now() + 30_000) scheduledAt = new Date(t).toISOString()
  }

  if (!templateId) return NextResponse.json({ error: 'Pick a template' }, { status: 400 })

  const admin = createAdminClient()

  // Load template (must belong to this company).
  const { data: tpl } = await admin
    .from('email_templates')
    .select('id, name, subject, design')
    .eq('company_id', access.companyId)
    .eq('id', templateId)
    .maybeSingle()
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const subject = String(tpl.subject || '').trim()
  if (!subject) return NextResponse.json({ error: 'This template has no subject line — add one before sending.' }, { status: 400 })

  // Render the email-safe HTML from the block design, absolutizing images against
  // this origin. Merge tokens ({{first_name}}) are left in place.
  const design = normalizeDesign(tpl.design)
  const bodyHtml = renderDesignToHtml(design, { baseUrl: new URL(request.url).origin })

  // Resolve the audience.
  let segmentName = 'Everyone'
  let audience
  if (segmentId) {
    const { data: seg } = await admin
      .from('email_segments')
      .select('id, name, filter')
      .eq('company_id', access.companyId)
      .eq('id', segmentId)
      .maybeSingle()
    if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 })
    segmentName = seg.name
    audience = await resolveSegment(admin, access.companyId, normalizeFilter(seg.filter))
  } else {
    audience = await getEmailAudience(admin, access.companyId)
  }

  if (!audience.length) {
    return NextResponse.json({ error: 'That segment has no subscribed recipients right now.' }, { status: 400 })
  }

  // Compliance / deliverability warnings (non-blocking — surfaced to the user).
  const { data: settings } = await admin
    .from('email_settings')
    .select('from_email, physical_address, domain_verified')
    .eq('company_id', access.companyId)
    .maybeSingle()
  const warnings: string[] = []
  if (!settings?.from_email) warnings.push('No sending address is configured (Admin → Email Marketing).')
  if (!settings?.domain_verified) warnings.push('The sending domain is not verified yet — emails will not deliver until it is.')
  if (!settings?.physical_address) warnings.push('No physical mailing address is set — required by CAN-SPAM. Add it in Admin → Email Marketing.')

  const { data: campaign, error: cErr } = await admin
    .from('email_campaigns')
    .insert({
      company_id: access.companyId,
      created_by: access.userId,
      template_id: tpl.id,
      segment_id: segmentId,
      name: name || `${tpl.name} → ${segmentName}`,
      subject,
      body_html: bodyHtml,
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

  const rows = audience.map((r) => ({
    campaign_id: campaign.id,
    contact_id: r.id,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    status: 'queued' as const,
  }))
  for (const part of chunk(rows, 500)) {
    const { error: rErr } = await admin.from('email_campaign_recipients').insert(part)
    if (rErr) {
      await admin.from('email_campaigns').delete().eq('id', campaign.id)
      return NextResponse.json({ error: rErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    campaign_id: campaign.id,
    recipient_count: audience.length,
    scheduled_at: scheduledAt,
    warnings,
  })
}
