// Per-company assistant settings + the usage/audit event log.

import type { Admin, ActorSource, HubActor } from './types'

export type AssistantSettings = {
  /** Master switch. Off → no native actions are offered anywhere. */
  enabled: boolean
  /** Whether Claude apps may connect over MCP (separate from the in-Hub bot). */
  mcpEnabled: boolean
  /** Whether outward actions must be previewed + confirmed. */
  requireConfirmation: boolean
  /**
   * Whether customer-facing actions may run over MCP at all. Off by default: the
   * same-turn confirmation binding can't protect that door (each tools/call is
   * its own request, so there are no turn boundaries we can see), which leaves
   * approval resting entirely on the connected Claude client's own per-tool
   * confirmation UI. That's a call for the company to make deliberately.
   */
  allowOutwardOverMcp: boolean
  /** Action names this company has turned off. */
  disabledActions: string[]
}

/** Fail-closed defaults: a company with no row has the assistant OFF. */
const DEFAULTS: AssistantSettings = {
  enabled: false,
  mcpEnabled: false,
  requireConfirmation: true,
  allowOutwardOverMcp: false,
  disabledActions: [],
}

export async function getAssistantSettings(
  admin: Admin,
  companyId: string,
): Promise<AssistantSettings> {
  try {
    const { data } = await admin
      .from('hub_assistant_settings')
      .select('enabled, mcp_enabled, require_confirmation, allow_outward_over_mcp, disabled_actions')
      .eq('company_id', companyId)
      .maybeSingle()
    if (!data) return { ...DEFAULTS }
    const d = data as {
      enabled?: boolean | null
      mcp_enabled?: boolean | null
      require_confirmation?: boolean | null
      allow_outward_over_mcp?: boolean | null
      disabled_actions?: string[] | null
    }
    return {
      enabled: d.enabled === true,
      mcpEnabled: d.mcp_enabled === true,
      // Only an explicit false turns confirmation off — a null must not open it.
      requireConfirmation: d.require_confirmation !== false,
      allowOutwardOverMcp: d.allow_outward_over_mcp === true,
      disabledActions: Array.isArray(d.disabled_actions) ? d.disabled_actions : [],
    }
  } catch {
    // A settings read failure must never silently ENABLE the assistant.
    return { ...DEFAULTS }
  }
}

/**
 * Record one assistant/MCP request. Fire-and-forget on purpose: this row is the
 * billing counter's source, and a dropped write only ever under-counts (never
 * over-bills), exactly like billing_caller_id_lookups.
 */
export function logAssistantEvent(
  admin: Admin,
  entry: {
    companyId: string
    userId?: string | null
    source: ActorSource
    toolName?: string | null
    toolCalls?: number
    inputTokens?: number | null
    outputTokens?: number | null
    model?: string | null
  },
): void {
  void admin
    .from('hub_assistant_events')
    .insert({
      company_id: entry.companyId,
      user_id: entry.userId ?? null,
      source: entry.source,
      tool_name: entry.toolName ?? null,
      tool_calls: entry.toolCalls ?? 0,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      model: entry.model ?? null,
    })
    .then(undefined, () => {})
}

/** True when this actor may use the assistant at all (company switch + Hub access). */
export async function assistantAvailableFor(
  admin: Admin,
  actor: HubActor,
): Promise<{ ok: true; settings: AssistantSettings } | { ok: false; reason: string }> {
  const settings = await getAssistantSettings(admin, actor.companyId)
  if (!settings.enabled) {
    return { ok: false, reason: 'The Hub Assistant is not enabled for this company.' }
  }
  return { ok: true, settings }
}
