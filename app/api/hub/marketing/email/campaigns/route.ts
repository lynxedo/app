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
  // Manual recipient picking — an explicit list of directory contact ids. Takes
  // precedence over a segment when present. We still intersect with the emailable
  // audience below so suppressed/unsubscribed picks can never sneak through.
  const contactIds = Array.isArray(body.contact_ids)
    ? [...new Set((body.contact_ids as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0))]
    : []
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

  // Resolve the email content. The compose flow sends the edited design + subject
  // directly (the campaign carries its own content, snapshotted here so later
  // template edits never change a sent campaign). template_id, if present, is just
  // provenance ("started from this template"); when no design is sent we fall back
  // to the template's own design (back-compat / "send as-is").
  // Absolute origin for image URLs. NEXT_PUBLIC_APP_URL is the public domain;
  // request.url's origin is the proxy-internal address behind the Cloudflare
  // tunnel (e.g. localhost:3000), which Gmail's image proxy can't fetch.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  let design = normalizeDesign(body.design)
  let subject = String(body.subject || '').trim()
  let sourceName = 'Campaign'

  if (templateId) {
    const { data: tpl } = await admin
      .from('email_templates')
      .select('id, name, subject, design')
      .eq('company_id', access.companyId)
      .eq('id', templateId)
      .maybeSingle()
    if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    sourceName = tpl.name
    if (!design.blocks.length) design = normalizeDesign(tpl.design)
    if (!subject) subject = String(tpl.subject || '').trim()
  }

  if (!design.blocks.length) return NextResponse.json({ error: 'Add some content to the email before sending.' }, { status: 400 })
  if (!subject) return NextResponse.json({ error: 'Add a subject line before sending.' }, { status: 400 })

  const bodyHtml = renderDesignToHtml(design, { baseUrl })

  // Resolve the audience. Precedence: explicit contact picks → segment → everyone.
  let segmentName = 'Everyone'
  let audience
  let usedSegmentId = segmentId
  if (contactIds.length) {
    const all = await getEmailAudience(admin, access.companyId)
    const picked = new Set(contactIds)
    audience = all.filter((r) => picked.has(r.id))
    segmentName = 'Selected contacts'
    usedSegmentId = null // a hand-picked list isn't a saved segment
  } else if (segmentId) {
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
    return NextResponse.json({
      error: contactIds.length
        ? 'None of the selected contacts are subscribed/emailable right now.'
        : 'That segment has no subscribed recipients right now.',
    }, { status: 400 })
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
      template_id: templateId || null,
      segment_id: usedSegmentId,
      name: name || `${sourceName} → ${segmentName}`,
      subject,
      design,
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
