import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, formatFrom, resendConfigured } from '@/lib/resend'
import { renderMergeFields } from '@/lib/email-markdown'
import { appendComplianceFooter, unsubscribeUrls, listUnsubscribeHeaders } from '@/lib/email-campaigns'

// Called by VPS cron every minute:
//   curl -s -X POST https://lynxedo.com/api/email/campaigns/process \
//     -H "x-cron-secret: $CRON_SECRET"
//
// Drains queued email_campaign_recipients under each campaign's throttle
// (throttle_per_min, default 60, capped at 120 = Resend's ~2 req/s). Mirrors the
// SMS broadcast drainer (app/api/txt/broadcasts/process). Runs for at most
// BATCH_MAX_MS so it never wedges the API process; the rest is picked up next tick.
//
// Per recipient: re-check the suppression ledger (someone may have unsubscribed
// since the campaign was queued), render {{merge}} fields against the recipient's
// snapshotted name, append the CAN-SPAM footer + one-click unsubscribe, send via
// Resend, and update the recipient row + campaign counters.

const BATCH_MAX_MS = 50_000
const PROCESS_MAX_PER_TICK = 300

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // No provider key yet (e.g. staging before RESEND_API_KEY) → HOLD: leave the
  // queue intact rather than burning recipients to 'failed'.
  if (!resendConfigured()) {
    return NextResponse.json({ processed: 0, held: true, message: 'resend_not_configured' })
  }

  const admin = createAdminClient()
  const startedAt = Date.now()
  const nowIso = new Date().toISOString()

  const { data: campaigns } = await admin
    .from('email_campaigns')
    .select('id, company_id, subject, body_html, throttle_per_min, scheduled_at')
    .in('status', ['queued', 'processing'])
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
    .order('created_at', { ascending: true })

  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json({ processed: 0, message: 'no work' })
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com').replace(/\/$/, '')
  let totalProcessed = 0
  const perCampaign: Record<string, { sent: number; failed: number; skipped: number }> = {}

  for (const c of campaigns) {
    if (Date.now() - startedAt > BATCH_MAX_MS) break
    if (totalProcessed >= PROCESS_MAX_PER_TICK) break

    // Sending identity for this company (read once per campaign per tick).
    const { data: settings } = await admin
      .from('email_settings')
      .select('from_name, from_email, reply_to, physical_address')
      .eq('company_id', c.company_id)
      .maybeSingle()
    if (!settings?.from_email) {
      // Config gap, not a recipient problem — leave queued, flag it, skip this campaign.
      await admin.from('email_campaigns')
        .update({ last_error: 'No sending address configured (Admin → Email Marketing).' })
        .eq('id', c.id)
      continue
    }

    // Promote to processing on first touch.
    await admin
      .from('email_campaigns')
      .update({ status: 'processing', started_at: new Date().toISOString(), last_error: null })
      .eq('id', c.id)
      .eq('status', 'queued')

    // Suppression set for this company (refreshed each tick; honors mid-campaign opt-outs).
    const { data: sup } = await admin
      .from('email_suppressions').select('email').eq('company_id', c.company_id)
    const suppressed = new Set((sup ?? []).map((s) => (s.email as string).toLowerCase()))

    const fromHeader = formatFrom(settings.from_name, settings.from_email)
    const interMessageDelayMs = Math.max(100, Math.floor(60_000 / Math.max(1, c.throttle_per_min || 60)))

    perCampaign[c.id] = perCampaign[c.id] || { sent: 0, failed: 0, skipped: 0 }

    while (Date.now() - startedAt <= BATCH_MAX_MS && totalProcessed < PROCESS_MAX_PER_TICK) {
      const { data: batch } = await admin
        .from('email_campaign_recipients')
        .select('id, email, first_name, last_name')
        .eq('campaign_id', c.id)
        .eq('status', 'queued')
        .limit(20)
      if (!batch || batch.length === 0) break

      for (const r of batch) {
        if (Date.now() - startedAt > BATCH_MAX_MS) break
        if (totalProcessed >= PROCESS_MAX_PER_TICK) break
        totalProcessed++

        const email = (r.email || '').trim()
        if (!email || suppressed.has(email.toLowerCase())) {
          await admin.from('email_campaign_recipients')
            .update({ status: 'skipped', error_message: email ? 'suppressed/unsubscribed' : 'no email', processed_at: new Date().toISOString() })
            .eq('id', r.id)
          perCampaign[c.id].skipped++
          continue
        }

        const merge = { first_name: r.first_name, last_name: r.last_name, email }
        const subject = renderMergeFields(c.subject || '', merge)
        const unsub = unsubscribeUrls(baseUrl, c.company_id, email, c.id)
        const html = appendComplianceFooter(
          renderMergeFields(c.body_html || '', merge),
          { brand: settings.from_name || '', physicalAddress: settings.physical_address, unsubscribeLink: unsub.link },
        )

        const result = await sendEmail({
          from: fromHeader,
          to: email,
          replyTo: settings.reply_to || undefined,
          subject,
          html,
          headers: listUnsubscribeHeaders(unsub.oneClick),
          tags: [{ name: 'type', value: 'campaign' }],
        })

        if (!result.ok) {
          await admin.from('email_campaign_recipients')
            .update({ status: 'failed', error_message: result.error, processed_at: new Date().toISOString() })
            .eq('id', r.id)
          perCampaign[c.id].failed++
        } else {
          await admin.from('email_campaign_recipients')
            .update({ status: 'sent', provider_message_id: result.id, processed_at: new Date().toISOString() })
            .eq('id', r.id)
          perCampaign[c.id].sent++
        }

        await new Promise((resolve) => setTimeout(resolve, interMessageDelayMs))
      }
    }

    // Recount + maybe complete.
    const { count: remaining } = await admin
      .from('email_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .eq('status', 'queued')

    const { data: counts } = await admin
      .from('email_campaign_recipients').select('status').eq('campaign_id', c.id)
    const tally = (s: string) => (counts ?? []).filter((row) => row.status === s).length
    const update: Record<string, unknown> = {
      sent_count: tally('sent'),
      failed_count: tally('failed'),
      skipped_count: tally('skipped'),
    }
    if ((remaining || 0) === 0) {
      update.status = 'complete'
      update.completed_at = new Date().toISOString()
    }
    await admin.from('email_campaigns').update(update).eq('id', c.id)
  }

  return NextResponse.json({
    processed: totalProcessed,
    campaigns: Object.keys(perCampaign).length,
    elapsed_ms: Date.now() - startedAt,
  })
}
