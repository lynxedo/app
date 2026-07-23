// Shared Inbox rules engine (the Hub half of the "Option C" hybrid — Outlook's own
// rules keep pre-filing mail at the provider; these rules add Hub concepts on top:
// assignment, urgency, auto-close, and mailbox folder moves).
//
// GENERIC BY DESIGN: a rule is a typed conditions array (field/op/value, matched
// 'all' or 'any') driving a typed actions array. Adding a new condition field or
// action type is a small additive change (extend the allowlists + one evaluator /
// executor branch) — never a redesign. Unknown fields/ops/action types stored by a
// FUTURE version of the app are skipped silently, so old code never breaks on new data.
//
// applyInboxRules runs inside the sync sweep (on the new-thread branch), so it is
// fully defensive: it never throws — every rule and every action is individually
// try/caught and only console.warn'd.

import type { SupabaseClient } from '@supabase/supabase-js'
import { nylasApiKey, nylasApiUri } from './config'

// ---------------------------------------------------------------------------
// Types + allowlists (exported for the admin API validators and the RulesPanel UI)
// ---------------------------------------------------------------------------

export const RULE_CONDITION_FIELDS = ['from_email', 'from_name', 'subject', 'body', 'to'] as const
export const RULE_CONDITION_OPS = ['contains', 'not_contains', 'equals', 'starts_with', 'ends_with'] as const
export const RULE_ACTION_TYPES = ['assign_to_user', 'move_to_folder', 'mark_urgent', 'auto_close', 'add_tag'] as const
export const RULE_MATCH_MODES = ['all', 'any'] as const
export const MAX_RULES_PER_COMPANY = 50

export type RuleConditionField = (typeof RULE_CONDITION_FIELDS)[number]
export type RuleConditionOp = (typeof RULE_CONDITION_OPS)[number]
export type RuleActionType = (typeof RULE_ACTION_TYPES)[number]
export type RuleMatchMode = (typeof RULE_MATCH_MODES)[number]

// field/op/type are plain strings (not the literal unions) so rows written by a
// future app version with new values still parse — the engine skips what it
// doesn't know.
export type RuleCondition = { field: string; op: string; value: string }
export type RuleAction = {
  type: string
  user_id?: string // assign_to_user
  provider_folder_id?: string // move_to_folder
  folder_name?: string // move_to_folder
  tag_id?: string // add_tag
  [key: string]: unknown // forward-compat params
}

export type InboxRule = {
  id: string
  company_id: string
  account_id: string | null
  name: string
  enabled: boolean
  sort_order: number
  match_mode: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  stop_processing: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Write-time validation (shared by POST + PATCH admin routes so malformed
// conditions/actions can never enter the table).
// ---------------------------------------------------------------------------

export function validateRuleConditions(input: unknown): { conditions?: RuleCondition[]; error?: string } {
  if (!Array.isArray(input)) return { error: 'conditions must be an array' }
  const out: RuleCondition[] = []
  for (const raw of input) {
    const c = raw as Record<string, unknown>
    if (!c || typeof c !== 'object') return { error: 'each condition must be an object { field, op, value }' }
    const field = typeof c.field === 'string' ? c.field : ''
    const op = typeof c.op === 'string' ? c.op : ''
    const value = typeof c.value === 'string' ? c.value.trim() : ''
    if (!(RULE_CONDITION_FIELDS as readonly string[]).includes(field)) {
      return { error: `Unknown condition field "${field}". Allowed: ${RULE_CONDITION_FIELDS.join(', ')}` }
    }
    if (!(RULE_CONDITION_OPS as readonly string[]).includes(op)) {
      return { error: `Unknown condition op "${op}". Allowed: ${RULE_CONDITION_OPS.join(', ')}` }
    }
    if (!value) return { error: 'Every condition needs a non-empty value' }
    out.push({ field, op, value })
  }
  return { conditions: out }
}

export function validateRuleActions(input: unknown): { actions?: RuleAction[]; error?: string } {
  if (!Array.isArray(input)) return { error: 'actions must be an array' }
  if (input.length === 0) return { error: 'A rule needs at least one action' }
  const out: RuleAction[] = []
  for (const raw of input) {
    const a = raw as Record<string, unknown>
    if (!a || typeof a !== 'object') return { error: 'each action must be an object { type, ...params }' }
    const type = typeof a.type === 'string' ? a.type : ''
    if (!(RULE_ACTION_TYPES as readonly string[]).includes(type)) {
      return { error: `Unknown action type "${type}". Allowed: ${RULE_ACTION_TYPES.join(', ')}` }
    }
    if (type === 'assign_to_user') {
      if (typeof a.user_id !== 'string' || !a.user_id) return { error: 'assign_to_user requires a user_id' }
      out.push({ type, user_id: a.user_id })
    } else if (type === 'move_to_folder') {
      const pfid = typeof a.provider_folder_id === 'string' ? a.provider_folder_id : ''
      const fname = typeof a.folder_name === 'string' ? a.folder_name.trim() : ''
      if (!pfid || !fname) return { error: 'move_to_folder requires provider_folder_id and folder_name' }
      out.push({ type, provider_folder_id: pfid, folder_name: fname })
    } else if (type === 'add_tag') {
      const tagId = typeof a.tag_id === 'string' ? a.tag_id.trim() : ''
      // Company/existence/active is re-checked at apply time (a rule may be scoped
      // to all mailboxes, and a tag could be deleted/deactivated after write).
      if (!tagId) return { error: 'add_tag requires a tag_id' }
      out.push({ type, tag_id: tagId })
    } else {
      out.push({ type }) // mark_urgent / auto_close carry no params
    }
  }
  return { actions: out }
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

export type RuleContext = {
  companyId: string
  accountId: string
  threadDbId: string
  providerThreadId: string
  subject: string | null
  fromEmail: string | null
  fromName: string | null
  toRecipients?: Array<{ email?: string }>
  bodyText?: string | null
}

function haystackFor(field: string, ctx: RuleContext): string | null {
  switch (field) {
    case 'from_email':
      return ctx.fromEmail ?? ''
    case 'from_name':
      return ctx.fromName ?? ''
    case 'subject':
      return ctx.subject ?? ''
    case 'body':
      return ctx.bodyText ?? ''
    case 'to':
      return (ctx.toRecipients ?? [])
        .map((r) => r.email || '')
        .filter(Boolean)
        .join(' ')
    default:
      return null // unknown field (written by a future version) → caller treats as no-match
  }
}

function evalCondition(cond: RuleCondition, ctx: RuleContext): boolean {
  const rawHaystack = haystackFor(cond.field, ctx)
  if (rawHaystack === null) return false // forward-compat: unknown field never matches
  const haystack = rawHaystack.toLowerCase()
  const needle = (cond.value || '').toLowerCase()
  switch (cond.op) {
    case 'contains':
      return haystack.includes(needle)
    case 'not_contains':
      return !haystack.includes(needle)
    case 'equals':
      return haystack === needle
    case 'starts_with':
      return haystack.startsWith(needle)
    case 'ends_with':
      return haystack.endsWith(needle)
    default:
      return false // forward-compat: unknown op never matches
  }
}

function ruleMatches(rule: InboxRule, ctx: RuleContext): boolean {
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : []
  if (conditions.length === 0) return false // a rule with zero conditions never matches
  if (rule.match_mode === 'any') return conditions.some((c) => evalCondition(c, ctx))
  return conditions.every((c) => evalCondition(c, ctx)) // 'all' (default, and any unknown mode)
}

// ---------------------------------------------------------------------------
// Nylas folder move (implemented locally — lib/inbox/nylas.ts is owned by a
// parallel agent and must not be edited; this reuses the same env config).
// Nylas v3: PUT /v3/grants/{grant}/threads/{id} { folders: [...] } moves the whole
// thread; if that fails (older connectors), fall back to moving each message via
// PUT /v3/grants/{grant}/messages/{id} { folders: [...] }.
// ---------------------------------------------------------------------------

const NYLAS_TIMEOUT_MS = 15000

async function nylasRuleFetch(path: string, init?: RequestInit): Promise<unknown> {
  const key = nylasApiKey()
  if (!key) throw new Error('Nylas not configured (NYLAS_API_KEY missing)')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NYLAS_TIMEOUT_MS)
  try {
    const res = await fetch(`${nylasApiUri()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const msg =
        (json as { error?: { message?: string }; message?: string } | null)?.error?.message ||
        (json as { message?: string } | null)?.message ||
        text ||
        `Nylas ${res.status}`
      throw new Error(`Nylas ${res.status}: ${msg}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

async function nylasMoveThreadToFolder(grantId: string, providerThreadId: string, folderId: string): Promise<void> {
  const g = encodeURIComponent(grantId)
  try {
    await nylasRuleFetch(`/v3/grants/${g}/threads/${encodeURIComponent(providerThreadId)}`, {
      method: 'PUT',
      body: JSON.stringify({ folders: [folderId] }),
    })
    return
  } catch (err) {
    console.warn('[inbox:rules] thread-level folder move failed, falling back to per-message:', err)
  }
  // Fallback: move each message in the thread individually.
  const q = new URLSearchParams({ thread_id: providerThreadId, limit: '100' })
  const body = (await nylasRuleFetch(`/v3/grants/${g}/messages?${q.toString()}`)) as {
    data?: Array<{ id: string }>
  } | null
  for (const m of body?.data || []) {
    if (!m?.id) continue
    await nylasRuleFetch(`/v3/grants/${g}/messages/${encodeURIComponent(m.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ folders: [folderId] }),
    })
  }
}

// ---------------------------------------------------------------------------
// Action executors. Each is individually best-effort; a failure logs and moves on.
// ---------------------------------------------------------------------------

function ruleDetail(rule: InboxRule): Record<string, unknown> {
  // Marker convention: actor_user_id null + detail.rule identifies an automated
  // rule action in the inbox_thread_events audit feed.
  return { rule: rule.name, rule_id: rule.id }
}

async function actAssignToUser(admin: SupabaseClient, rule: InboxRule, action: RuleAction, ctx: RuleContext) {
  const userId = action.user_id
  if (!userId || typeof userId !== 'string') return

  // Re-verify company membership at run time (the target may have been removed
  // or moved since the rule was written) — mirrors the assign route's guard.
  const { data: target } = await admin.from('user_profiles').select('company_id').eq('id', userId).maybeSingle()
  if (!target || target.company_id !== ctx.companyId) {
    console.warn(`[inbox:rules] rule "${rule.name}": assign target not in company, skipped`)
    return
  }

  // Only auto-assign an 'open' thread — never clobber a human assignment or a
  // closed thread. The conditional update tells us whether it applied.
  const { data: updated } = await admin
    .from('inbox_threads')
    .update({ assigned_to_user_id: userId, status: 'assigned', updated_at: new Date().toISOString() })
    .eq('id', ctx.threadDbId)
    .eq('status', 'open')
    .select('id')
  if (!updated || updated.length === 0) return

  // Seat the owner membership row (single-seat, same bookkeeping as the assign route).
  await admin.from('inbox_thread_members').delete().eq('thread_id', ctx.threadDbId).eq('role', 'owner')
  await admin.from('inbox_thread_members').delete().eq('thread_id', ctx.threadDbId).eq('user_id', userId)
  await admin.from('inbox_thread_members').insert({
    thread_id: ctx.threadDbId,
    user_id: userId,
    role: 'owner',
    added_by: null,
  })

  await admin.from('inbox_thread_events').insert({
    company_id: ctx.companyId,
    thread_id: ctx.threadDbId,
    event_type: 'assigned',
    actor_user_id: null, // automated — see detail.rule
    target_user_id: userId,
    detail: ruleDetail(rule),
  })
}

async function actMarkUrgent(admin: SupabaseClient, _rule: InboxRule, ctx: RuleContext) {
  await admin
    .from('inbox_threads')
    .update({ urgent: true, updated_at: new Date().toISOString() })
    .eq('id', ctx.threadDbId)
}

async function actAutoClose(admin: SupabaseClient, rule: InboxRule, ctx: RuleContext) {
  const { data: updated } = await admin
    .from('inbox_threads')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', ctx.threadDbId)
    .neq('status', 'closed')
    .select('id')
  if (!updated || updated.length === 0) return
  await admin.from('inbox_thread_events').insert({
    company_id: ctx.companyId,
    thread_id: ctx.threadDbId,
    event_type: 'closed',
    actor_user_id: null, // automated — see detail.rule
    detail: ruleDetail(rule),
  })
}

async function actMoveToFolder(admin: SupabaseClient, rule: InboxRule, action: RuleAction, ctx: RuleContext) {
  const folderId = action.provider_folder_id
  const folderName = action.folder_name
  if (!folderId || typeof folderId !== 'string') return

  // Guard: the folder must actually belong to this account (a rule may be scoped
  // to all mailboxes with account_id=null, so a stale/foreign folder id can't be
  // ruled out at write time). If it isn't a real folder here, do nothing —
  // mirroring a phantom folder would make the Hub UI show a folder the mailbox
  // doesn't have.
  const { data: folderRow } = await admin
    .from('inbox_folders')
    .select('name')
    .eq('account_id', ctx.accountId)
    .eq('provider_folder_id', folderId)
    .maybeSingle()
  if (!folderRow) {
    console.warn(`[inbox:rules] rule "${rule.name}": folder ${folderId} not on account ${ctx.accountId}; skipping move`)
    return
  }

  // Real mailbox move via Nylas. Only mirror locally when the provider move
  // SUCCEEDS — otherwise Hub would show a filing the real mailbox never did. A
  // provider hiccup must not fail the sweep; the next sweep re-mirrors real state.
  let moved = false
  try {
    const { data: account } = await admin
      .from('inbox_accounts')
      .select('nylas_grant_id')
      .eq('id', ctx.accountId)
      .maybeSingle()
    const grantId = account?.nylas_grant_id as string | null | undefined
    if (grantId) {
      await nylasMoveThreadToFolder(grantId, ctx.providerThreadId, folderId)
      moved = true
    }
  } catch (err) {
    console.warn(`[inbox:rules] rule "${rule.name}": Nylas folder move failed:`, err)
  }
  if (!moved) return

  await admin
    .from('inbox_threads')
    .update({
      folder: (typeof folderName === 'string' && folderName) || (folderRow.name as string) || null,
      provider_folder_ids: [folderId],
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.threadDbId)
}

async function actAddTag(admin: SupabaseClient, rule: InboxRule, action: RuleAction, ctx: RuleContext) {
  const tagId = action.tag_id
  if (!tagId || typeof tagId !== 'string') return

  // The tag must belong to this company and still be active. A rule may be scoped
  // to all mailboxes (account_id=null) and a tag can be deleted/deactivated after
  // the rule is written, so validate at run time — never tag with a foreign/dead id.
  const { data: tag } = await admin
    .from('inbox_tags')
    .select('id')
    .eq('id', tagId)
    .eq('company_id', ctx.companyId)
    .eq('active', true)
    .maybeSingle()
  if (!tag) {
    console.warn(`[inbox:rules] rule "${rule.name}": tag ${tagId} not found/active for company; skipping`)
    return
  }

  // Append to the denormalized tags array, deduped. Read-modify-write is fine here:
  // the sweep processes one new thread at a time, so there is no concurrent writer.
  const { data: threadRow } = await admin
    .from('inbox_threads')
    .select('tags')
    .eq('id', ctx.threadDbId)
    .maybeSingle()
  const current: string[] = Array.isArray(threadRow?.tags) ? (threadRow!.tags as string[]) : []
  if (current.includes(tagId)) return // already tagged — no-op, no duplicate event

  await admin
    .from('inbox_threads')
    .update({ tags: [...current, tagId], updated_at: new Date().toISOString() })
    .eq('id', ctx.threadDbId)

  await admin.from('inbox_thread_events').insert({
    company_id: ctx.companyId,
    thread_id: ctx.threadDbId,
    event_type: 'tag_added',
    actor_user_id: null, // automated — see detail.rule
    detail: { ...ruleDetail(rule), tag_id: tagId },
  })
}

// ---------------------------------------------------------------------------
// Engine entry point — called by the sync sweep on newly-mirrored threads.
// (The orchestrator wires the sync.ts hook; the signature below is the contract.)
// ---------------------------------------------------------------------------

export async function applyInboxRules(
  admin: SupabaseClient,
  ctx: {
    companyId: string
    accountId: string
    threadDbId: string
    providerThreadId: string
    subject: string | null
    fromEmail: string | null
    fromName: string | null
    toRecipients?: Array<{ email?: string }>
    bodyText?: string | null
  }
): Promise<{ matched: string[] }> {
  const matched: string[] = []
  try {
    const { data, error } = await admin
      .from('inbox_rules')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('enabled', true)
      .or(`account_id.is.null,account_id.eq.${ctx.accountId}`)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) {
      console.warn('[inbox:rules] failed to load rules:', error.message)
      return { matched }
    }
    const rules = (data ?? []) as InboxRule[]

    for (const rule of rules) {
      try {
        if (!ruleMatches(rule, ctx)) continue
        matched.push(rule.name)

        const actions = Array.isArray(rule.actions) ? rule.actions : []
        for (const action of actions) {
          try {
            switch (action.type) {
              case 'assign_to_user':
                await actAssignToUser(admin, rule, action, ctx)
                break
              case 'move_to_folder':
                await actMoveToFolder(admin, rule, action, ctx)
                break
              case 'mark_urgent':
                await actMarkUrgent(admin, rule, ctx)
                break
              case 'auto_close':
                await actAutoClose(admin, rule, ctx)
                break
              case 'add_tag':
                await actAddTag(admin, rule, action, ctx)
                break
              default:
                // Forward-compat: an action type written by a future version is skipped silently.
                break
            }
          } catch (err) {
            console.warn(`[inbox:rules] rule "${rule.name}" action "${action.type}" failed:`, err)
          }
        }

        if (rule.stop_processing) break // Outlook parity
      } catch (err) {
        console.warn(`[inbox:rules] rule "${rule.name}" evaluation failed:`, err)
      }
    }
  } catch (err) {
    // The engine runs inside the sync sweep — it must never throw.
    console.warn('[inbox:rules] applyInboxRules failed:', err)
  }
  return { matched }
}
