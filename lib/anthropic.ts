// Shared Anthropic/Claude client (audit AI3/AI4). The client was constructed
// `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` in 6 files, and the
// default model id was re-typed as DEFAULT_MODEL / CLAUDE_MODEL in ~8 places.
// This is the single source of truth for both.
//
// Note: the Guardian model is DB-configurable (guardian_settings.model). That
// logic stays in lib/hub-claude.ts / lib/guardian-knowledge.ts — those just use
// CLAUDE_MODEL here as the fallback when no DB override is set.
import Anthropic from '@anthropic-ai/sdk'

/** Default Claude model for all Lynxedo AI features (current as of the audit). */
export const CLAUDE_MODEL = 'claude-sonnet-4-6'

let cached: Anthropic | null = null

type AnthropicOpts = {
  /** Explicit key (call sites that validated one already). Defaults to env. */
  apiKey?: string
  /** Per-request timeout in ms (transcription/responder use 60_000). */
  timeout?: number
  /** SDK retry count (transcription/responder use 2). */
  maxRetries?: number
}

/**
 * Returns an Anthropic client. With no options, returns a shared cached client
 * reading ANTHROPIC_API_KEY. Pass options (apiKey/timeout/maxRetries) to get a
 * purpose-built client — used by the transcription + responder paths.
 */
export function getAnthropic(opts?: AnthropicOpts): Anthropic {
  if (opts && (opts.apiKey || opts.timeout != null || opts.maxRetries != null)) {
    return new Anthropic({
      apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
      ...(opts.timeout != null ? { timeout: opts.timeout } : {}),
      ...(opts.maxRetries != null ? { maxRetries: opts.maxRetries } : {}),
    })
  }
  if (!cached) cached = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return cached
}

export default getAnthropic
