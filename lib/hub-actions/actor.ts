// Resolving a HubActor — the identity every assistant action runs as.
//
// SECURITY: the actor is built from a user id that the CALLER already
// authenticated (a Hub session for Guardian, a hashed bearer token for MCP).
// Nothing here trusts request bodies, tool arguments, or model output. The
// company_id comes from user_profiles, never from the request — so a token or a
// prompt cannot point an action at another tenant.

import type { HubActor, ActorSource, Admin } from './types'

/**
 * Every can_* permission column on user_profiles is copied into actor.flags.
 * We select('*') and filter by prefix rather than listing columns, so a new
 * permission flag is picked up automatically — one less file to remember in the
 * ~8-file flag checklist. Non-permission columns are ignored.
 */
function extractFlags(profile: Record<string, unknown>): Record<string, boolean> {
  const flags: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(profile)) {
    if (key.startsWith('can_')) flags[key] = value === true
  }
  return flags
}

/**
 * Resolve a user id to the actor an action will run as, or null when the user
 * can't act at all: unknown, no company, locked (security cutoff), or
 * deactivated (offboarded). Those last two mirror app/hub/layout.tsx's redirect
 * to /locked — a locked employee's Claude connection must go dead with their
 * login, not outlive it.
 */
export async function resolveHubActor(
  admin: Admin,
  userId: string,
  source: ActorSource,
): Promise<HubActor | null> {
  const { data: profile } = await admin
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) return null
  const p = profile as Record<string, unknown>
  const companyId = typeof p.company_id === 'string' ? p.company_id : null
  if (!companyId) return null
  if (p.locked_at || p.deactivated_at) return null

  const { data: hubUser } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle()

  const role = typeof p.role === 'string' ? p.role : null

  return {
    companyId,
    userId,
    displayName: (hubUser?.display_name as string | undefined)?.trim() || 'A teammate',
    role,
    isAdmin: role === 'admin',
    flags: extractFlags(p),
    source,
  }
}
