// Per-company assistant settings + the usage/audit event log.

import type { Admin, ActorSource, HubActor } from './types'
import type { MemoryMode } from './memory'

export type AssistantSettings = {
  /** Master switch. Off → no native actions are offered anywhere. */
  enabled: boolean
  /** Whether Claude apps may connect over MCP (separate from the in-Hub bot). */
  mcpEnabled: boolean
  /** Whether outward actions must be previewed + confirmed. */
  requireConfirmation: boolean
  /**
   * Whether customer-facing actions (texting a customer) may run over MCP at
   * all. Off by default: the same-turn confirmation binding can't protect that
   * door (each tools/call is its own request, so there are no turn boundaries we
   * can see), which leaves approval resting entirely on the connected Claude
   * client's own per-tool confirmation UI. That's a call for the company to make
   * deliberately.
   */
  allowOutwardOverMcp: boolean
  /**
   * Whether Jobber schedule writes may run over MCP. Its OWN switch rather than
   * riding on allowOutwardOverMcp: a company that wants Claude to handle its
   * texts should not have to hand over the crew calendar to get it, and the two
   * failure modes are nothing alike — a bad text is visible to the customer at
   * once, a bad reschedule is silent until a truck shows up on the wrong day.
   */
  allowJobberWritesOverMcp: boolean
  /** Whether Jobber schedule changes must be previewed + confirmed. */
  requireJobberConfirmation: boolean
  /** Default-ON actions this company has turned OFF. */
  disabledActions: string[]
  /** Default-OFF actions this company has turned ON (the opt-in set). */
  enabledActions: string[]
  /**
   * How much of a conversation the assistant carries between messages.
   * 'light' (default) — a short note of what it did and which records it
   * touched. 'full' — the real transcript replayed, which costs meaningfully
   * more per message. 'off' — the old behaviour, every reply from nothing.
   * See lib/hub-actions/memory.ts.
   */
  memoryMode: MemoryMode
}

/** Fail-closed defaults: a company with no row has the assistant OFF. */
const DEFAULTS: AssistantSettings = {
  enabled: false,
  mcpEnabled: false,
  requireConfirmation: true,
  allowOutwardOverMcp: false,
  allowJobberWritesOverMcp: false,
  requireJobberConfirmation: true,
  disabledActions: [],
  enabledActions: [],
  // Light is the default rather than 'off': the old no-memory behaviour is what
  // made the assistant re-run lookups and lose staged confirmations, so a
  // company that never touches this setting should get the fix.
  memoryMode: 'light',
}

export async function getAssistantSettings(
  admin: Admin,
  companyId: string,
): Promise<AssistantSettings> {
  try {
    const { data } = await admin
      .from('hub_assistant_settings')
      .select(
        'enabled, mcp_enabled, require_confirmation, allow_outward_over_mcp, allow_jobber_writes_over_mcp, require_jobber_confirmation, disabled_actions, enabled_actions, memory_mode',
      )
      .eq('company_id', companyId)
      .maybeSingle()
    if (!data) return { ...DEFAULTS }
    const d = data as {
      enabled?: boolean | null
      mcp_enabled?: boolean | null
      require_confirmation?: boolean | null
      allow_outward_over_mcp?: boolean | null
      allow_jobber_writes_over_mcp?: boolean | null
      require_jobber_confirmation?: boolean | null
      disabled_actions?: string[] | null
      enabled_actions?: string[] | null
      memory_mode?: string | null
    }
    return {
      enabled: d.enabled === true,
      mcpEnabled: d.mcp_enabled === true,
      // Only an explicit false turns confirmation off — a null must not open it.
      requireConfirmation: d.require_confirmation !== false,
      allowOutwardOverMcp: d.allow_outward_over_mcp === true,
      allowJobberWritesOverMcp: d.allow_jobber_writes_over_mcp === true,
      // Null must not open it, same reasoning as requireConfirmation above.
      requireJobberConfirmation: d.require_jobber_confirmation !== false,
      disabledActions: Array.isArray(d.disabled_actions) ? d.disabled_actions : [],
      enabledActions: Array.isArray(d.enabled_actions) ? d.enabled_actions : [],
      // An unrecognised or missing value falls back to the default rather than
      // to 'off' — a typo in this column should not silently remove memory.
      memoryMode:
        d.memory_mode === 'off' || d.memory_mode === 'full' || d.memory_mode === 'light'
          ? d.memory_mode
          : DEFAULTS.memoryMode,
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
