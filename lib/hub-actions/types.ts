// Hub Assistant action layer — shared types.
//
// The action layer is the ONE place that defines what an AI assistant can do
// inside a tenant's Hub. It is consumed by two doors:
//
//   1. lib/hub-claude.ts    — Guardian, the in-Hub assistant (Hub DMs + rooms)
//   2. app/api/mcp/route.ts — the official Lynxedo MCP server (claude.ai, Claude
//      Code, cowork), authenticated by bearer token
//
// The invariant that makes this safe for a multi-tenant SaaS: every action runs
// as a specific HubActor — one company, one user, that user's permission flags.
// There is no elevated "assistant identity". If a user can't do it in the UI,
// the assistant can't do it for them.
//
// See Reference/PRDs/HUB_ASSISTANT_AND_MCP_PRD.md.

import type Anthropic from '@anthropic-ai/sdk'
import type { createAdminClient } from '@/lib/supabase/admin'

export type Admin = ReturnType<typeof createAdminClient>

/** Where the request came in from. Recorded on every usage event. */
export type ActorSource = 'guardian' | 'mcp'

/**
 * The resolved identity an action executes as. Built server-side from a user id
 * only (lib/hub-actions/actor.ts) — NEVER from request input, a tool argument,
 * or a model-supplied value. `flags` holds every can_* column on user_profiles.
 */
export type HubActor = {
  companyId: string
  userId: string
  displayName: string
  role: string | null
  isAdmin: boolean
  flags: Record<string, boolean>
  source: ActorSource
}

/**
 * What an action needs from the actor.
 *  - null      -> any Hub user
 *  - anyFlag   -> at least one of these flags is true
 *  - allFlags  -> all of these flags are true
 *
 * Admins bypass flag checks (matching requireAdminArea's `isSuperAdmin || grant`
 * rule). Admins do NOT bypass confirmation on outward actions.
 */
export type ActionGate =
  | null
  | { anyFlag: string[]; allFlags?: never }
  | { allFlags: string[]; anyFlag?: never }

/**
 * read    — reads tenant data, no side effects
 * write   — creates/updates INTERNAL records (board task, note, Hub message)
 * outward — reaches a customer or an external system. Requires confirmation:
 *           the first call only previews and stages the action.
 */
export type ActionKind = 'read' | 'write' | 'outward'

export type ActionContext = {
  admin: Admin
  actor: HubActor
}

/**
 * One assistant capability. `run` returns a plain string the model reads back —
 * the same convention lib/amber-tools.ts established. It must NEVER throw: the
 * dispatcher catches, but an instructive message is far more useful to the model
 * than a generic failure.
 */
export type HubAction = {
  name: string
  /** Written for the model: when to use it, and what not to guess. */
  description: string
  input_schema: Anthropic.Tool['input_schema']
  kind: ActionKind
  gate: ActionGate
  /** Short human phrase for the OAuth consent screen, e.g. "text customers". */
  consentLabel: string
  run: (ctx: ActionContext, args: Record<string, unknown>) => Promise<string>
}

/** Does this actor pass the gate? Admin bypasses flag checks. */
export function actorPassesGate(actor: HubActor, gate: ActionGate): boolean {
  if (gate === null) return true
  if (actor.isAdmin) return true
  if ('anyFlag' in gate && gate.anyFlag) {
    // [].some() is false, so an empty list correctly denies.
    return gate.anyFlag.some((f) => actor.flags[f] === true)
  }
  if ('allFlags' in gate && gate.allFlags) {
    // [].every() is TRUE — an empty allFlags would silently allow everyone. A gate
    // that names no flag is a mistake, so treat it as "deny" rather than "open".
    if (gate.allFlags.length === 0) return false
    return gate.allFlags.every((f) => actor.flags[f] === true)
  }
  return false
}

// -- Small shared helpers for action implementations --------------------------

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  return typeof v === 'string' ? v.trim() : ''
}

export function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return fallback
}

/** Clamp a model-supplied row count into a sane window. */
export function limitArg(args: Record<string, unknown>, fallback: number, max: number): number {
  return Math.max(1, Math.min(max, Math.round(num(args, 'limit', fallback))))
}

export function uuidArg(args: Record<string, unknown>, key: string): string | null {
  const v = str(args, key)
  return UUID_RE.test(v) ? v : null
}
