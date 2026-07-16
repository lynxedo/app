// Shared validation/normalization for a drip campaign's ordered steps + triggers.
// Used by the create + update routes so a saved step array is always well-formed
// for the engine (lib/drip.ts). step_index is assigned by array position.
//
// Channels (the engine dispatches these — see lib/drip.ts advanceDripEnrollments):
//   sms   → content_ref { body } (inline) or { template_id }
//   email → content_ref { subject, body } (body is Markdown) or { subject, template_id },
//           plus optional { identity_id } (a verified email sending identity; the
//           route re-validates ownership with validIdentityId).
//   rvm   → content_ref { audio_asset_id } (ringless voicemail; dark until the
//           company enables + confirms consent in drip_settings).
//
// Model: a step's `delay` is the wait BEFORE it fires. Step 0 is the instant first
// touch (delay forced to {minutes:0} — the engine schedules next_run_at=now on
// enroll); later steps carry the gap after the previous step ({hours:N} | {days:N}).

export type RawDripStep = { channel?: string; delay?: any; content_ref?: any }
export type CleanDripStep = { step_index: number; channel: string; delay: any; content_ref: any }
export type DripStepsResult = { ok: true; steps: CleanDripStep[] } | { ok: false; error: string }

// Triggers the builder + engine understand. new_lead / lead_source enroll via the
// cron sweep (lib/drip.ts runDripEnrollmentSweeps); manual enrolls from the UI;
// stage_changed enrolls when a Lead Tracker card moves into the configured
// tracker_stages.key (enrollment wired in the tracker path — the builder here just
// captures the trigger + config). Centralized so both routes validate identically.
export const DRIP_TRIGGERS = ['new_lead', 'lead_source', 'manual', 'stage_changed'] as const
export type DripTrigger = (typeof DRIP_TRIGGERS)[number]
export function isDripTrigger(t: unknown): t is DripTrigger {
  return typeof t === 'string' && (DRIP_TRIGGERS as readonly string[]).includes(t)
}

const CHANNELS = new Set(['sms', 'email', 'rvm'])
const MAX_STEPS = 20
const MAX_SMS_BODY = 1200 // ~a handful of SMS segments; generous but not unbounded
const MAX_EMAIL_BODY = 20000 // Markdown email body — generous but bounded
const MAX_SUBJECT = 300

export function normalizeDripSteps(raw: unknown): DripStepsResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'Steps must be a list.' }
  if (raw.length > MAX_STEPS) return { ok: false, error: `A campaign can have at most ${MAX_STEPS} steps.` }
  const steps: CleanDripStep[] = []
  raw.forEach((s: RawDripStep, i) => {
    const channel = typeof s?.channel === 'string' && CHANNELS.has(s.channel) ? s.channel : null
    if (!channel) throw new StepError(`Step ${i + 1}: pick a channel (text, email, or voicemail).`)

    // Step 0 = the instant first touch (delay forced to 0). Later steps carry the gap.
    const delay = i === 0 ? { minutes: 0 } : normDelay(s?.delay)
    const content_ref = normalizeContentRef(channel, s?.content_ref, i)
    steps.push({ step_index: i, channel, delay, content_ref })
  })
  return { ok: true, steps }
}

// Emit exactly the content_ref shape the engine reads for each channel.
function normalizeContentRef(channel: string, ref: any, i: number): any {
  if (channel === 'sms') {
    const body = typeof ref?.body === 'string' ? ref.body.trim() : ''
    const templateId = typeof ref?.template_id === 'string' ? ref.template_id : ''
    if (!body && !templateId) throw new StepError(`Step ${i + 1}: write the text message.`)
    if (body.length > MAX_SMS_BODY) throw new StepError(`Step ${i + 1}: message is too long (max ${MAX_SMS_BODY} characters).`)
    return body ? { body } : { template_id: templateId }
  }
  if (channel === 'email') {
    const subject = typeof ref?.subject === 'string' ? ref.subject.trim() : ''
    const body = typeof ref?.body === 'string' ? ref.body.trim() : ''
    const templateId = typeof ref?.template_id === 'string' ? ref.template_id : ''
    if (!subject) throw new StepError(`Step ${i + 1}: add an email subject.`)
    if (subject.length > MAX_SUBJECT) throw new StepError(`Step ${i + 1}: subject is too long (max ${MAX_SUBJECT} characters).`)
    if (!body && !templateId) throw new StepError(`Step ${i + 1}: write the email message.`)
    if (body.length > MAX_EMAIL_BODY) throw new StepError(`Step ${i + 1}: email is too long (max ${MAX_EMAIL_BODY} characters).`)
    const out: any = templateId ? { subject, template_id: templateId } : { subject, body }
    // Optional per-step sending identity — shape-checked here; the create/update
    // route re-validates ownership with validIdentityId (nulls it out if it isn't
    // this company's identity) before persisting.
    if (typeof ref?.identity_id === 'string' && ref.identity_id.trim()) out.identity_id = ref.identity_id.trim()
    return out
  }
  if (channel === 'rvm') {
    const assetId = typeof ref?.audio_asset_id === 'string' ? ref.audio_asset_id.trim() : ''
    if (!assetId) throw new StepError(`Step ${i + 1}: choose the voicemail recording.`)
    return { audio_asset_id: assetId }
  }
  throw new StepError(`Step ${i + 1}: unsupported channel.`)
}

/** Wrap normalizeDripSteps so callers get a result object instead of a throw. */
export function safeNormalizeDripSteps(raw: unknown): DripStepsResult {
  try {
    return normalizeDripSteps(raw)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid steps.' }
  }
}

class StepError extends Error {}

function normDelay(d: any): { days?: number; hours?: number; minutes?: number } {
  const days = Number(d?.days)
  const hours = Number(d?.hours)
  const minutes = Number(d?.minutes)
  const cfg: { days?: number; hours?: number; minutes?: number } = {}
  if (days > 0) cfg.days = Math.round(days)
  if (hours > 0) cfg.hours = Math.round(hours)
  if (minutes > 0) cfg.minutes = Math.round(minutes)
  // A follow-up with no/invalid delay defaults to +1 day (never back-to-back by accident).
  if (!cfg.days && !cfg.hours && !cfg.minutes) cfg.days = 1
  return cfg
}
