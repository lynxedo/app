// What the in-Hub assistant may do for a given person — ONE rule, shared with
// the native action layer (lib/hub-actions):
//
//   Anyone allowed to use the assistant can LOOK THINGS UP.
//   Managers and admins can also make CHANGES (Jobber schedule, notes) and use
//   live web search.
//
// This replaced the per-person guardian_tier ladder (basic/manager/full) in
// August 2026. The ladder predated the action layer and had become a second,
// parallel permission model for the same assistant: an admin configured tiers in
// one card and action toggles in another, and the two could disagree. At
// retirement the ladder was provably redundant — the only people who could talk
// to the assistant at all (hub_users.claude_allowed) were a manager and an
// admin, both hand-set to 'full', so deriving capability from role changed
// nobody's effective behavior. The guardian_tier column and
// rooms.guardian_full_access still exist in the DB but nothing reads them.
//
// Access itself (may this person use the assistant at all?) is a separate
// switch: hub_users.claude_allowed, checked by the messages route before any of
// this comes into play.

export type AssistantCapability = 'manage' | 'read'

/**
 * Capability from the person's role — managers and admins manage, everyone
 * else reads. Matches the native action layer's posture, where Jobber writes
 * are gated behind manager-flag/admin checks (see JOBBER_WRITE_GATE in
 * lib/hub-actions/actions-jobber.ts).
 */
export function capabilityFromRole(role: string | null | undefined): AssistantCapability {
  return role === 'admin' || role === 'manager' ? 'manage' : 'read'
}

// Legacy Heroes MCP-server tools visible to read-capability users — read-only
// Jobber/Captivated lookups + Hub directory. Maintain as that server adds
// tools; anything not listed is invisible to non-managers.
const READ_ONLY_TOOLS = new Set<string>([
  // Jobber read
  'search_clients',
  'get_client_details',
  'get_job_details',
  'get_jobs',
  'get_quotes',
  'get_invoices',
  'get_visits',
  'get_visits_by_date',
  'get_users',
  // Captivated read
  'find_captivated_contact',
  // Hub directory
  'hub_list_rooms',
  'hub_list_users',
  // Schema introspection — read-only, useful for diagnostics
  'introspect_type',
  'test_connection',
])

// Legacy MCP tools that DUPLICATE a capability the native action layer owns.
//
// ⚠ This set exists because the duplication was not theoretical. Guardian is
// offered both tool sets at once for the Heroes tenant (the legacy MCP server is
// single-tenant, so only that company sees it at all), and the two doors are not
// equivalent: the native action goes through the actor's permission gate, the
// company's enabled/disabled action list, the confirmation gate for anything
// consequential, and the billing meter. The legacy tool goes through none of
// them. Given both, the model simply picks whichever name reads better — so on
// 2026-08-07 a Hub post went out as `hub_send_message` (posting as the bot, no
// event logged) and a visit was rescheduled via `update_visit_schedule` while
// `enabled_actions` was empty and `require_jobber_confirmation` was true. Every
// admin control said that write was off. It happened anyway.
//
// The rule is deliberately narrow and mechanical: if the action layer owns the
// capability, the action layer is the only door. Legacy tools with no native
// equivalent (Jobber creates, quotes, custom fields) are untouched — withholding
// those would remove capability rather than route it.
const SHADOWED_BY_NATIVE_ACTIONS = new Set<string>([
  // → post_hub_message
  'hub_send_message',
  'hub_send_dm',
  // → create_task
  'hub_add_board_item',
  // → jobber_reschedule_visit
  'update_visit_schedule',
  'update_job_schedule',
  'update_future_visits',
  'edit_visit',
  'schedule_visit',
  // → jobber_assign_visit
  'update_visit_assigned_users',
  // → jobber_complete_visit (and its inverse, which would otherwise undo a
  //   confirmed completion without a confirmation of its own)
  'mark_visit_complete',
  'uncomplete_visit',
  // → jobber_add_note
  'create_job_note',
  'create_client_note',
  // → send_customer_text. These reach a real customer with no confirmation
  //   binding whatsoever. They are also dead — Captivated was cancelled in July
  //   2026 — so today this only stops the model wasting a turn on a call that
  //   cannot succeed. It stops rather more than that if anyone ever repoints
  //   them at a live provider.
  'send_text',
  'send_bulk_message',
])

/**
 * Predicate deciding whether a legacy MCP tool is visible.
 *
 * Two independent filters: the capability tier (manage → everything, read → the
 * read-only set), and the native-action shadow above.
 *
 * `nativeActionsActive` is false when the assistant is switched off for the
 * company or no actor could be resolved — in that case no native action is on
 * offer, so shadowing a legacy tool would remove the capability rather than
 * redirect it, and the legacy set behaves exactly as it did before.
 */
export function getMcpToolFilter(
  capability: AssistantCapability,
  opts?: { nativeActionsActive?: boolean },
): (toolName: string) => boolean {
  const shadowed = opts?.nativeActionsActive === true
  return (name: string) => {
    if (shadowed && SHADOWED_BY_NATIVE_ACTIONS.has(name)) return false
    if (capability === 'manage') return true
    return READ_ONLY_TOOLS.has(name)
  }
}
