// Shared validation/normalization for a drip campaign's ordered steps. Used by the
// create + update routes so a saved step array is always well-formed for the engine
// (lib/drip.ts). step_index is assigned by array position.
//
// Model (Increment 1 = SMS only): each step is a text send. A step's `delay` is the
// wait BEFORE it fires. Step 0 is the instant first touch (delay forced to 0 — the
// engine schedules next_run_at=now on enroll); later steps carry the gap after the
// previous text. content_ref = { body } (inline) or { template_id }.

export type RawDripStep = { channel?: string; delay?: any; content_ref?: any }
export type CleanDripStep = { step_index: number; channel: string; delay: any; content_ref: any }
export type DripStepsResult = { ok: true; steps: CleanDripStep[] } | { ok: false; error: string }

const MAX_STEPS = 20
const MAX_BODY = 1200 // ~a handful of SMS segments; generous but not unbounded

export function normalizeDripSteps(raw: unknown): DripStepsResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'Steps must be a list.' }
  if (raw.length > MAX_STEPS) return { ok: false, error: `A campaign can have at most ${MAX_STEPS} steps.` }
  const steps: CleanDripStep[] = []
  raw.forEach((s: RawDripStep, i) => {
    // Phase 1: SMS only. email/rvm channels land in later phases.
    const channel = s?.channel === 'sms' ? 'sms' : null
    if (!channel) throw new StepError(`Step ${i + 1}: only text (SMS) steps are supported right now.`)

    const body = typeof s?.content_ref?.body === 'string' ? s.content_ref.body.trim() : ''
    const templateId = typeof s?.content_ref?.template_id === 'string' ? s.content_ref.template_id : ''
    if (!body && !templateId) throw new StepError(`Step ${i + 1}: write the text message.`)
    if (body.length > MAX_BODY) throw new StepError(`Step ${i + 1}: message is too long (max ${MAX_BODY} characters).`)

    // Step 0 = the instant first touch (delay forced to 0). Later steps carry the gap.
    const delay = i === 0 ? { minutes: 0 } : normDelay(s?.delay)
    const content_ref = body ? { body } : { template_id: templateId }
    steps.push({ step_index: i, channel, delay, content_ref })
  })
  return { ok: true, steps }
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
