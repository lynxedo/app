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

/**
 * Predicate deciding whether a legacy MCP tool is visible to the capability.
 * manage → everything; read → the read-only set.
 */
export function getMcpToolFilter(capability: AssistantCapability): (toolName: string) => boolean {
  if (capability === 'manage') return () => true
  return (name: string) => READ_ONLY_TOOLS.has(name)
}
