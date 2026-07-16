// The unified drip-marketing engine (Drip Marketing PRD §5). Increment 1 = SMS
// speed-to-lead. Two halves, both driven by the /api/drip/process cron:
//
//   1) runDripEnrollmentSweeps  — triggers (new_lead / lead_source) enroll matching
//      `leads` rows into active campaigns (idempotent: one enrollment per
//      (campaign, lead) via a partial unique index). The watermark is captured
//      BEFORE the scan and the unique index is the real guard, so no lead is ever
//      missed or double-enrolled.
//   2) advanceDripEnrollments   — the state machine. For each due enrollment, fire
//      the current step (send SMS via the existing lib/txt-send stack so the text
//      lands in the customer's normal Txt thread and replies route back for the
//      auto-pause), then schedule the next step by its delay.
//
// Auto-pause lives out of band in pauseEnrollmentsForInbound(), called by the Txt
// inbound webhook: the instant the lead replies, their active enrollments flip to
// 'replied' (or 'opted_out' on STOP) and the tick simply skips non-'active' rows.
//
// Model note: a step's `delay` is the wait BEFORE that step fires, applied when we
// SCHEDULE into it. Enrollment sets next_run_at = now, so step 0 is the instant
// first touch; step N's delay is the gap after step N-1. Guards run in order:
// opted-out → quiet-hours (defer) → frequency cap (defer) → send. Modeled directly
// on the proven email automation engine (lib/email-automations.ts).
import { createAdminClient } from '@/lib/supabase/admin'
import { sendDirectTxtToPhone } from '@/lib/txt-send'
import { toE164 } from '@/lib/twilio'
import { fetchAllRows } from '@/lib/email-contacts'

type Admin = ReturnType<typeof createAdminClient>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type CampaignRow = {
  id: string
  company_id: string
  trigger_type: string
  trigger_config: any
  status: string
  quiet_hours: any
  last_swept_at: string | null
  created_at: string
}

type StepRow = { channel: string; delay: any; content_ref: any }

type QuietHours = { start: number; end: number; tz: string }
type Settings = {
  quiet_hours: QuietHours
  send_as_user_id: string | null
  frequency_cap: number
}

const DEFAULT_QUIET: QuietHours = { start: 8, end: 20, tz: 'America/Chicago' }

// ─── 1. Enrollment sweeps ────────────────────────────────────────────────────

export async function runDripEnrollmentSweeps(admin: Admin): Promise<{ enrolled: number }> {
  const { data: campaigns } = await admin
    .from('drip_campaigns')
    .select('id, company_id, trigger_type, trigger_config, status, quiet_hours, last_swept_at, created_at')
    .eq('status', 'active')

  let enrolled = 0
  for (const c of (campaigns ?? []) as CampaignRow[]) {
    // Capture the watermark BEFORE the scan; the partial unique index prevents
    // any double-enroll, so this only ever bounds the scan window.
    const sweepStart = new Date().toISOString()
    if (c.trigger_type === 'new_lead') enrolled += await sweepLeads(admin, c, null)
    else if (c.trigger_type === 'lead_source') {
      const src = typeof c.trigger_config?.lead_source === 'string' ? c.trigger_config.lead_source : null
      if (src) enrolled += await sweepLeads(admin, c, src)
    }
    // 'manual' enrolls via the UI, not a sweep.
    await admin.from('drip_campaigns').update({ last_swept_at: sweepStart }).eq('id', c.id)
  }
  return { enrolled }
}

// New `leads` rows (with a phone) created since the last sweep — the watermark is
// seeded at activation, so activating a campaign does NOT blast the back-catalog.
async function sweepLeads(admin: Admin, c: CampaignRow, leadSource: string | null): Promise<number> {
  const cutoff = c.last_swept_at || c.created_at
  const rows = await fetchAllRows<any>(() => {
    let q = admin
      .from('leads')
      .select('id, company_id, phone, first_name, last_name')
      .eq('company_id', c.company_id)
      .not('phone', 'is', null)
      .gt('created_at', cutoff)
    if (leadSource) q = q.eq('lead_source', leadSource)
    return q.order('id', { ascending: true })
  })

  const enrollRows = rows
    .map((r) => {
      const e164 = toE164(r.phone || '')
      if (!e164) return null
      return {
        company_id: c.company_id,
        campaign_id: c.id,
        lead_id: r.id as string,
        phone: e164,
        phone_digits: e164.replace(/\D/g, '').slice(-10),
        current_step_index: 0,
        status: 'active',
        next_run_at: new Date().toISOString(),
      }
    })
    .filter(Boolean) as Record<string, unknown>[]
  if (!enrollRows.length) return 0

  let inserted = 0
  for (const part of chunk(enrollRows, 500)) {
    // (campaign_id, lead_id) is uniquely indexed (where lead_id is not null), so
    // ignoreDuplicates is safe: conflicting rows aren't returned, so data.length
    // is the count actually enrolled this sweep.
    const { data } = await admin
      .from('drip_enrollments')
      .upsert(part, { onConflict: 'campaign_id,lead_id', ignoreDuplicates: true })
      .select('id')
    inserted += (data ?? []).length
  }
  return inserted
}

// ─── 2. Advancement (the state machine) ──────────────────────────────────────

type EnrollmentRow = {
  id: string
  company_id: string
  campaign_id: string
  lead_id: string | null
  contact_id: string | null
  phone: string | null
  phone_digits: string | null
  current_step_index: number
}

export async function advanceDripEnrollments(
  admin: Admin,
  opts: { startedAt: number; maxMs: number; maxCount: number },
): Promise<{ processed: number; sent: number }> {
  const campaigns = new Map<string, CampaignRow | null>()
  const steps = new Map<string, StepRow[]>()
  const settings = new Map<string, Settings>()

  let processed = 0
  let sent = 0

  async function getCampaign(id: string): Promise<CampaignRow | null> {
    if (campaigns.has(id)) return campaigns.get(id)!
    const { data } = await admin
      .from('drip_campaigns')
      .select('id, company_id, trigger_type, trigger_config, status, quiet_hours, last_swept_at, created_at')
      .eq('id', id)
      .maybeSingle()
    campaigns.set(id, (data as CampaignRow) ?? null)
    return (data as CampaignRow) ?? null
  }
  async function getSteps(campaignId: string): Promise<StepRow[]> {
    if (steps.has(campaignId)) return steps.get(campaignId)!
    const { data } = await admin
      .from('drip_steps')
      .select('channel, delay, content_ref')
      .eq('campaign_id', campaignId)
      .eq('active', true)
      .order('step_index', { ascending: true })
    const arr = (data ?? []) as StepRow[]
    steps.set(campaignId, arr)
    return arr
  }
  async function getSettings(companyId: string): Promise<Settings> {
    if (settings.has(companyId)) return settings.get(companyId)!
    const { data } = await admin
      .from('drip_settings')
      .select('quiet_hours, send_as_user_id, frequency_cap')
      .eq('company_id', companyId)
      .maybeSingle()
    const s: Settings = {
      quiet_hours: normalizeQuiet((data as any)?.quiet_hours),
      send_as_user_id: (data as any)?.send_as_user_id ?? null,
      frequency_cap: typeof (data as any)?.frequency_cap === 'number' ? (data as any).frequency_cap : 6,
    }
    settings.set(companyId, s)
    return s
  }

  while (Date.now() - opts.startedAt <= opts.maxMs && processed < opts.maxCount) {
    const { data: due } = await admin
      .from('drip_enrollments')
      .select('id, company_id, campaign_id, lead_id, contact_id, phone, phone_digits, current_step_index')
      .eq('status', 'active')
      .lte('next_run_at', new Date().toISOString())
      .order('next_run_at', { ascending: true })
      .limit(25)
    if (!due || due.length === 0) break

    for (const e of due as EnrollmentRow[]) {
      if (Date.now() - opts.startedAt > opts.maxMs || processed >= opts.maxCount) break
      processed++

      const campaign = await getCampaign(e.campaign_id)
      if (!campaign || campaign.status !== 'active') {
        // Paused/deleted mid-flight: park it an hour out so we don't reselect it every tick.
        await admin
          .from('drip_enrollments')
          .update({ next_run_at: new Date(Date.now() + 3_600_000).toISOString() })
          .eq('id', e.id)
        continue
      }

      const s = await getSettings(e.company_id)
      if (!s.send_as_user_id) {
        // No sender configured → HOLD this company's enrollments (mirrors the email
        // engine holding when no sending identity is set). Park an hour out.
        await admin
          .from('drip_enrollments')
          .update({ next_run_at: new Date(Date.now() + 3_600_000).toISOString() })
          .eq('id', e.id)
        continue
      }

      const stepList = await getSteps(e.campaign_id)
      const idx = e.current_step_index
      if (idx >= stepList.length) {
        await admin
          .from('drip_enrollments')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', e.id)
        continue
      }
      const step = stepList[idx]

      // Increment 1 only sends SMS. A non-SMS step (email/rvm, later phases) is
      // skipped forward so a mixed campaign doesn't stall on an unbuilt channel.
      if (step.channel !== 'sms') {
        await logSend(admin, e, idx, step.channel, 'skipped_suppressed', { body: null })
        await advanceStep(admin, e, idx, stepList)
        continue
      }

      // ── Guard: opted-out (do_not_text on the existing contact) ────────────────
      const person = await resolvePerson(admin, e)
      if (person?.do_not_text) {
        await logSend(admin, e, idx, 'sms', 'skipped_opted_out', { body: null, to: e.phone })
        await admin
          .from('drip_enrollments')
          .update({ status: 'opted_out', paused_reason: 'do_not_text', completed_at: new Date().toISOString() })
          .eq('id', e.id)
        continue
      }

      // ── Guard: quiet hours (defer, never drop) ────────────────────────────────
      const qh = campaign.quiet_hours ? normalizeQuiet(campaign.quiet_hours) : s.quiet_hours
      const deferUntil = quietHoursDefer(new Date(), qh)
      if (deferUntil) {
        await admin.from('drip_enrollments').update({ next_run_at: deferUntil.toISOString() }).eq('id', e.id)
        continue
      }

      // ── Guard: frequency cap (rolling 24h, per person across campaigns) ───────
      if (e.phone) {
        const since = new Date(Date.now() - 86_400_000).toISOString()
        const { count } = await admin
          .from('drip_sends')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', e.company_id)
          .eq('status', 'sent')
          .eq('to_phone', e.phone)
          .gte('sent_at', since)
        if ((count ?? 0) >= s.frequency_cap) {
          // Defer past the rolling window into the next allowed send time.
          const next = quietHoursDefer(new Date(Date.now() + 3 * 3_600_000), qh) || new Date(Date.now() + 3 * 3_600_000)
          await admin.from('drip_enrollments').update({ next_run_at: next.toISOString() }).eq('id', e.id)
          continue
        }
      }

      // ── Send ──────────────────────────────────────────────────────────────────
      const body = renderBody(step.content_ref, person)
      const templateId = typeof step.content_ref?.template_id === 'string' ? step.content_ref.template_id : null
      if (!body && !templateId) {
        // Nothing to send on this step — skip forward.
        await logSend(admin, e, idx, 'sms', 'failed', { body: null, to: e.phone, error: 'empty_step' })
        await advanceStep(admin, e, idx, stepList)
        continue
      }

      const res = await sendDirectTxtToPhone({
        admin,
        companyId: e.company_id,
        userId: s.send_as_user_id,
        phone: e.phone || '',
        name: person?.name ?? null,
        body: body || '',
        templateId,
      })

      await logSend(admin, e, idx, 'sms', res.ok ? 'sent' : 'failed', {
        body: body || null,
        to: e.phone,
        providerRef: res.twilio_sid ?? null,
        error: res.ok ? null : res.error ?? null,
      })
      if (res.ok) sent++

      // Stamp the resolved contact so reply-pause can match this enrollment even
      // if the contact was created by this very send.
      const contactId = (res as any).contact_id ?? e.contact_id ?? null
      await advanceStep(admin, e, idx, stepList, contactId)
      await sleep(200) // gentle spacing between sends
    }
  }

  return { processed, sent }
}

// Advance an enrollment past step `idx`: either complete, or schedule the next
// step by its (pre-)delay.
async function advanceStep(
  admin: Admin,
  e: EnrollmentRow,
  idx: number,
  stepList: StepRow[],
  contactId?: string | null,
): Promise<void> {
  const next = idx + 1
  const patch: Record<string, unknown> = { current_step_index: next }
  if (contactId !== undefined && contactId !== null) patch.contact_id = contactId
  if (next >= stepList.length) {
    patch.status = 'completed'
    patch.completed_at = new Date().toISOString()
  } else {
    patch.next_run_at = new Date(Date.now() + waitMs(stepList[next].delay)).toISOString()
  }
  await admin.from('drip_enrollments').update(patch).eq('id', e.id)
}

type Person = { id: string | null; name: string | null; first_name: string | null; do_not_text: boolean }

// Resolve the contact for opt-out + personalization: existing directory row by
// phone digits, falling back to the source lead's name (contact may not exist
// until the first send creates it).
async function resolvePerson(admin: Admin, e: EnrollmentRow): Promise<Person | null> {
  if (e.phone_digits) {
    const { data } = await admin
      .from('txt_contacts')
      .select('id, name, first_name, do_not_text')
      .eq('company_id', e.company_id)
      .in('phone_digits', [e.phone_digits, '1' + e.phone_digits])
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (data) return data as Person
  }
  if (e.lead_id) {
    const { data } = await admin
      .from('leads')
      .select('first_name, last_name')
      .eq('id', e.lead_id)
      .maybeSingle()
    if (data) {
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim() || null
      return { id: null, name, first_name: (data.first_name as string) ?? null, do_not_text: false }
    }
  }
  return null
}

async function logSend(
  admin: Admin,
  e: EnrollmentRow,
  stepIndex: number,
  channel: string,
  status: string,
  extra: { body?: string | null; to?: string | null; providerRef?: string | null; error?: string | null },
): Promise<void> {
  await admin.from('drip_sends').insert({
    enrollment_id: e.id,
    campaign_id: e.campaign_id,
    company_id: e.company_id,
    step_index: stepIndex,
    channel,
    status,
    provider_ref: extra.providerRef ?? null,
    to_phone: extra.to ?? null,
    body: extra.body ?? null,
    error: extra.error ?? null,
  })
}

// ─── 3. Auto-pause on inbound (called by the Txt inbound webhook) ─────────────

// The instant a lead engages, stop the drip. STOP → opted_out; any other inbound
// → replied (paused) so a human/Amber takes over. Best-effort + idempotent.
export async function pauseEnrollmentsForInbound(
  admin: Admin,
  opts: { companyId: string; contactId?: string | null; phone?: string | null; isOptOut: boolean },
): Promise<{ paused: number }> {
  const digits = opts.phone ? opts.phone.replace(/\D/g, '').slice(-10) : null
  const contactId = opts.contactId && /^[0-9a-f-]{36}$/i.test(opts.contactId) ? opts.contactId : null
  if (!contactId && !digits) return { paused: 0 }

  const patch: Record<string, unknown> = {
    status: opts.isOptOut ? 'opted_out' : 'replied',
    paused_reason: opts.isOptOut ? 'sms_stop' : 'inbound_reply',
  }
  if (opts.isOptOut) patch.completed_at = new Date().toISOString()

  let q = admin.from('drip_enrollments').update(patch).eq('company_id', opts.companyId).eq('status', 'active')
  // contactId is a validated uuid, digits is stripped to [0-9] — safe to inline.
  if (contactId && digits) q = q.or(`contact_id.eq.${contactId},phone_digits.eq.${digits}`)
  else if (contactId) q = q.eq('contact_id', contactId)
  else q = q.eq('phone_digits', digits as string)

  const { data } = await q.select('id')
  return { paused: (data ?? []).length }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function waitMs(config: any): number {
  const days = num(config?.days)
  const hours = num(config?.hours)
  const minutes = num(config?.minutes)
  let ms = 0
  if (days) ms += days * 86_400_000
  if (hours) ms += hours * 3_600_000
  if (minutes) ms += minutes * 60_000
  return ms > 0 ? ms : 0 // no/invalid delay → fire on the next tick
}

function normalizeQuiet(qh: any): QuietHours {
  const start = num(qh?.start)
  const end = num(qh?.end)
  const tz = typeof qh?.tz === 'string' && qh.tz ? qh.tz : DEFAULT_QUIET.tz
  return {
    start: start != null && start >= 0 && start <= 23 ? start : DEFAULT_QUIET.start,
    end: end != null && end >= 1 && end <= 24 ? end : DEFAULT_QUIET.end,
    tz,
  }
}

function renderBody(contentRef: any, person: Person | null): string | null {
  const raw = typeof contentRef?.body === 'string' ? contentRef.body : null
  if (!raw) return null
  const first = person?.first_name?.trim() || person?.name?.trim()?.split(' ')[0] || ''
  const name = person?.name?.trim() || first || ''
  return raw
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\s{2,}/g, ' ') // tidy up if a token expanded to empty
    .trim()
}

// The tz offset (ms) at `date`: add to a UTC instant to read wall-clock in `tz`.
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  })
  const map: Record<string, number> = {}
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
  const asUTC = Date.UTC(map.year, (map.month || 1) - 1, map.day, (map.hour || 0) % 24, map.minute || 0, map.second || 0)
  return asUTC - date.getTime()
}

// If `now` is inside the quiet-hours window, return the next allowed send time
// (today's or tomorrow's window start, in the configured tz). Null = send now.
function quietHoursDefer(now: Date, qh: QuietHours): Date | null {
  if (qh.start <= 0 && qh.end >= 24) return null // 24h window = no quiet hours
  const offset = tzOffsetMs(now, qh.tz)
  const wall = new Date(now.getTime() + offset) // UTC fields now read as tz wall time
  const hour = wall.getUTCHours()
  if (hour >= qh.start && hour < qh.end) return null // inside allowed window

  const y = wall.getUTCFullYear(), m = wall.getUTCMonth(), d = wall.getUTCDate()
  // Before the window opens today → today at start; after it closes → tomorrow at start.
  const dayOffset = hour < qh.start ? 0 : 1
  const targetWallAsUTC = Date.UTC(y, m, d + dayOffset, qh.start, 0, 0)
  return new Date(targetWallAsUTC - offset)
}
