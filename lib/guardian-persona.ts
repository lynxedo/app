// Shared Guardian identity + knowledge assembly — the single source of truth
// for how Guardian/AI behaves across EVERY surface (a direct @Guardian question,
// the Responder voicemail reply, and the Txt2 + Hub composer helpers: Suggest,
// Polish, Catch me up).
//
// Before this module each surface wrote its own from-scratch persona and pulled
// (or skipped) knowledge inconsistently, so the same assistant sounded and
// behaved differently depending on which button you pressed. Now every surface
// shares GUARDIAN_CORE (identity + universal rules) and the same knowledge
// loading, then layers only its own task-specific instructions on top.
//
// IMPORTANT — read-only against company data. This module loads the company's
// live Knowledge Base docs (guardian_knowledge_docs) and never writes, resets,
// or seeds them. Admins keep editing those docs in Admin → Guardian exactly as
// before; this just makes more surfaces read them.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getAlwaysIncludedDocs,
  getKnowledgeDoc,
  estimateTokens,
} from '@/lib/guardian-knowledge'
import { createAdminClient } from '@/lib/supabase/admin'

// Anthropic's prompt-cache activation floor. Below this the SDK silently ignores
// cache_control, so we only attach it to prefixes large enough to actually cache.
const PROMPT_CACHE_MIN_TOKENS = 1024

// The Anthropic `system` param accepts either a plain string or an array of
// content blocks (so we can attach cache_control to the stable prefix). Both the
// agentic path (lib/hub-claude.ts) and the direct-call routes pass this shape.
export type SystemBlock =
  | string
  | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>

// ---------------------------------------------------------------------------
// GUARDIAN_CORE — the universal identity + rules that apply on EVERY surface,
// including a direct question to Guardian. Keep this to principles that are true
// no matter the task; anything task-specific (e.g. "return only the message
// body", "never reveal you're an AI" for outgoing drafts) belongs in the per-
// surface task layer, not here. Company-specific facts (services, pricing, the
// refer-out list, customer-service standards) live in the Knowledge Base so Ben
// can edit them without a code change — not here.
// ---------------------------------------------------------------------------
export const GUARDIAN_CORE = `You are part of Heroes Lawn Care of The Woodlands / Spring / Conroe / Magnolia / Montgomery / Tomball / Cypress, TX — a local company doing lawn fertilization & weed control, irrigation (sprinkler) service, mosquito & fire ant control, and pet waste pickup.

Principles that always apply, no matter the task:
- Speak in Heroes' voice: warm, local, plain-spoken, like a real teammate — never corporate, stiff, or robotic.
- Never invent facts. Use only what's in this prompt, the knowledge below, the conversation, or the account data provided. If you don't know something, don't guess — say what you do know.
- Never promise a specific date, time, or price unless it's a fixed, published fee you are 100% certain of. Scheduling and quotes are committed by the live team, not automatically.
- Lead with empathy on any complaint or concern; never get defensive.
- Be concise and get to the point. Match the length and register of the surrounding conversation.`

// 'voice'    → GUARDIAN_CORE + the company's always-included Knowledge Base docs.
//              Used for internal team-chat helpers and for polishing/summarizing,
//              where the customer-service sales playbook isn't relevant.
// 'customer' → everything in 'voice' PLUS the customer-service playbook
//              (the `customer_service` Knowledge Base doc). Used wherever Guardian
//              writes to OR advises on a customer (Responder, Txt2 Suggest, and a
//              direct @Guardian question — so "how do I handle this customer?"
//              answers from the real playbook).
export type GuardianKnowledge = 'voice' | 'customer'

/**
 * Assemble a Guardian system prompt that shares the same identity + knowledge
 * across every surface, then appends the caller's task-specific instructions.
 *
 * Layout (top → bottom):
 *   GUARDIAN_CORE
 *   --- always-included Knowledge Base docs
 *   --- customer-service playbook        (only when knowledge === 'customer')
 *   --- task                             (this surface's specific instructions)
 *   --- CUSTOMER ACCOUNT (from Jobber)   (only when jobberSummary is provided)
 *
 * The stable prefix (everything except the per-call Jobber summary) is returned
 * as one cache-controlled block when it's large enough to cache, so the shared
 * persona + knowledge is billed once and reused across calls. The Jobber summary
 * — which differs per customer — is a separate trailing block so it never busts
 * the shared cache.
 *
 * Knowledge-load failures are non-fatal: Guardian still answers on GUARDIAN_CORE
 * + task alone rather than erroring.
 */
export async function buildGuardianSystem(opts: {
  companyId: string
  knowledge: GuardianKnowledge
  task: string
  jobberSummary?: string | null
  admin?: SupabaseClient
}): Promise<SystemBlock> {
  const admin = opts.admin ?? createAdminClient()
  const sections: string[] = [GUARDIAN_CORE]

  // Always-included KB docs — the company-wide knowledge Ben flags to travel
  // everywhere. Same loader the Responder and @Guardian already use.
  try {
    const docs = await getAlwaysIncludedDocs(admin, opts.companyId)
    if (docs.length > 0) {
      sections.push(docs.map((d) => `## ${d.title}\n\n${d.body}`).join('\n\n---\n\n'))
    }
  } catch {
    // non-fatal — proceed without the always-included docs
  }

  // Customer-service playbook — only for surfaces that write to / advise on a
  // customer. Pulled by the well-known `customer_service` slug.
  if (opts.knowledge === 'customer') {
    try {
      const doc = await getKnowledgeDoc(admin, opts.companyId, 'customer_service')
      if (doc?.body?.trim()) {
        sections.push(
          `COMPANY KNOWLEDGE — Customer Service Standards & Templates:\n\n${doc.body}`
        )
      }
    } catch {
      // non-fatal — proceed without the playbook
    }
  }

  // This surface's task-specific instructions.
  sections.push(opts.task)

  const stablePrefix = sections.join('\n\n---\n\n')
  const cacheable = estimateTokens(stablePrefix) >= PROMPT_CACHE_MIN_TOKENS

  const jobber = opts.jobberSummary?.trim()
    ? `CUSTOMER ACCOUNT (from Jobber):\n${opts.jobberSummary.trim()}`
    : null

  // No Jobber suffix → a single block (string when too small to cache).
  if (!jobber) {
    return cacheable
      ? [{ type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } }]
      : stablePrefix
  }

  // Jobber suffix kept as its own uncached trailing block so per-customer data
  // never busts the shared persona/knowledge cache.
  return [
    cacheable
      ? { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: stablePrefix },
    { type: 'text', text: jobber },
  ]
}
