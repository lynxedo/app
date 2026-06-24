// Shared validation/normalization for an automation's ordered steps. Used by the
// create + update routes so a saved step array is always well-formed for the
// engine (lib/email-automations.ts). step_index is assigned by array position.

export type RawStep = { type?: string; config?: any }
export type CleanStep = { step_index: number; type: 'send' | 'wait' | 'condition'; config: any }

export type StepsResult = { ok: true; steps: CleanStep[] } | { ok: false; error: string }

export function normalizeSteps(raw: unknown): StepsResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'Steps must be a list.' }
  const steps: CleanStep[] = []
  raw.forEach((s: RawStep, i) => {
    const type = s?.type
    if (type === 'send') {
      const templateId = s?.config?.template_id
      if (typeof templateId !== 'string' || !templateId) throw new StepError(`Step ${i + 1}: pick a template to send.`)
      steps.push({ step_index: i, type: 'send', config: { template_id: templateId } })
    } else if (type === 'wait') {
      const days = Number(s?.config?.days)
      const hours = Number(s?.config?.hours)
      if (!(days > 0) && !(hours > 0)) throw new StepError(`Step ${i + 1}: a wait needs a number of days (or hours).`)
      const cfg: any = {}
      if (days > 0) cfg.days = Math.round(days)
      if (hours > 0) cfg.hours = Math.round(hours)
      steps.push({ step_index: i, type: 'wait', config: cfg })
    } else if (type === 'condition') {
      const tagId = s?.config?.if?.has_tag
      if (typeof tagId !== 'string' || !tagId) throw new StepError(`Step ${i + 1}: a condition needs a tag to check.`)
      steps.push({
        step_index: i,
        type: 'condition',
        config: {
          if: { has_tag: tagId },
          then_step: numOrNull(s?.config?.then_step),
          else_step: numOrNull(s?.config?.else_step),
        },
      })
    } else {
      throw new StepError(`Step ${i + 1}: unknown step type.`)
    }
  })
  return { ok: true, steps }
}

class StepError extends Error {}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Wrap normalizeSteps so callers get a result object instead of a throw. */
export function safeNormalizeSteps(raw: unknown): StepsResult {
  try {
    return normalizeSteps(raw)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid steps.' }
  }
}
