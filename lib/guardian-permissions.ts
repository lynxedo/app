import type { SupabaseClient } from '@supabase/supabase-js'

export type GuardianTier = 'basic' | 'manager' | 'full'

const DEFAULT_TIER: GuardianTier = 'basic'

// Tools available to basic-tier users — read-only Jobber/Captivated lookups + Hub directory.
// Maintain this list as the MCP server adds tools. Anything not here is invisible to basic users.
const BASIC_ALLOWED_TOOLS = new Set<string>([
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

// Manager tier adds scheduling + note creation but still no broadcast/messaging.
const MANAGER_ADDITIONAL_TOOLS = new Set<string>([
  'schedule_visit',
  'edit_visit',
  'update_visit_schedule',
  'update_visit_assigned_users',
  'update_future_visits',
  'update_job_schedule',
  'mark_visit_complete',
  'uncomplete_visit',
  'delete_visit',
  'delete_visit_line_items',
  'create_job_note',
  'create_client_note',
  'set_job_custom_field',
])

const MANAGER_ALLOWED_TOOLS: Set<string> = new Set([
  ...BASIC_ALLOWED_TOOLS,
  ...MANAGER_ADDITIONAL_TOOLS,
])

/**
 * Returns a predicate that decides whether an MCP tool is visible to the given tier.
 * full → always true (no filter)
 * manager → BASIC + scheduling/notes
 * basic → BASIC only
 */
export function getMcpToolFilter(tier: GuardianTier): (toolName: string) => boolean {
  if (tier === 'full') return () => true
  const allowed = tier === 'manager' ? MANAGER_ALLOWED_TOOLS : BASIC_ALLOWED_TOOLS
  return (name: string) => allowed.has(name)
}

/**
 * Resolves the Guardian tier for a user in a specific message context.
 *
 * Resolution order (highest wins):
 *   1. role = 'admin' → 'full'
 *   2. room has guardian_full_access = true → 'full'
 *   3. user_profiles.guardian_tier
 *
 * Pass either the user-session or admin client — both can SELECT user_profiles
 * for the calling user, and rooms.guardian_full_access has no RLS restriction.
 */
export async function resolveGuardianTier(
  supabase: SupabaseClient,
  userId: string,
  context: { roomId?: string | null; conversationId?: string | null }
): Promise<GuardianTier> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, guardian_tier')
    .eq('id', userId)
    .maybeSingle()

  if (profile?.role === 'admin') return 'full'

  if (context.roomId) {
    const { data: room } = await supabase
      .from('rooms')
      .select('guardian_full_access')
      .eq('id', context.roomId)
      .maybeSingle()
    if (room?.guardian_full_access === true) return 'full'
  }

  const tier = (profile?.guardian_tier as GuardianTier | null) ?? DEFAULT_TIER
  if (tier === 'basic' || tier === 'manager' || tier === 'full') return tier
  return DEFAULT_TIER
}
