// Amber's own account — Phase 1 of the "Amber 90%" plan.
//
// Every other action in this layer runs AS the person talking to the assistant.
// That model cannot cover work nobody asked for (a 7:30 AM office run, a first
// text to a lead that came in overnight), because there is no person to borrow
// permissions from. This file gives Amber a NARROW account of her own:
//
//   • A code-side list of the only actions she may take on her own. Reads are
//     always on. Acting actions are switched per company in Admin → AI →
//     Amber's account: 'off' (the default — no row), 'approve' (she prepares it,
//     a person taps Approve) or 'auto' (it runs and is logged).
//   • Nothing she prepares runs on her say-so. A queued item can only be carried
//     out by an approver's own Hub request (app/api/hub/amber/queue/[id]); she
//     has no session, so she cannot approve her own work — the same reason the
//     staged-turn rule exists for the in-chat assistant.
//   • Every proposal and every automatic run is a row in amber_queue. That table
//     IS the audit log, and the per-action approval stats are counted from it.
//
// An action joins the list only after checking how it behaves when the actor is
// the bot user (no profile; her own posts are limited to public rooms and shared
// boards). Anything that reaches a customer can never be set to automatic.
// Amber 90% PRD: https://claude.ai/code/artifact/486f8088-2681-4f9a-b3f7-4bff2a4be15d

import { getHubBotUserId } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'
import type { ActionContext, Admin, HubActor } from './types'
import { str } from './types'
import { clip, lines } from './format'

export type AmberMode = 'off' | 'approve' | 'auto'

/** Reads Amber may run on her own. Always on; they change nothing. */
export const AMBER_READ_ACTIONS: ReadonlySet<string> = new Set([
  'find_contact',
  'get_customer_overview',
  'get_schedule',
  'lookup_neighborhood',
  'search_texts',
  'read_text_conversation',
  'get_call_activity',
  'list_leads',
  'review_leads',
  'list_tasks',
])

/** Actions Amber may take on her own, each behind its own off/approve/auto
 *  switch.
 *   • editable   — arguments an approver may rewrite before approving (always free
 *                  text, never a recipient, so an edit can't redirect a send).
 *   • autoAllowed — false for anything that reaches a customer: her reads include
 *                  text customers wrote (texts, voicemail transcripts, lead forms),
 *                  so a planted instruction must always meet a person first.
 *   • succeeded  — actions return a sentence rather than throwing; this reads the
 *                  sentence so a failure is logged as 'failed', not 'approved'. */
type AmberActingAction = { label: string; editable: string[]; autoAllowed: boolean; succeeded: (out: string) => boolean }
export const AMBER_ACTING_ACTIONS: Record<string, AmberActingAction> = {
  send_customer_text: { label: 'Text a customer', editable: ['message'], autoAllowed: false, succeeded: (o) => o.startsWith('Sent.') },
  post_hub_message: {
    label: 'Post a message in the Hub',
    editable: ['message'],
    autoAllowed: true,
    succeeded: (o) => o.startsWith('Posted in #') || o.startsWith('Sent '),
  },
  create_task: { label: 'Create a task', editable: ['content'], autoAllowed: true, succeeded: (o) => o.startsWith('Task added to ') },
  add_contact_note: { label: 'Add a note to a contact', editable: ['note'], autoAllowed: true, succeeded: (o) => o.startsWith('Note added to ') },
}

/** Own-property lookup, so "__proto__" / "constructor" are never an action. */
export function amberActingAction(name: string): AmberActingAction | null {
  return Object.prototype.hasOwnProperty.call(AMBER_ACTING_ACTIONS, name) ? AMBER_ACTING_ACTIONS[name] : null
}

/** For the client: label + editable fields only. */
export function amberActionLabels(): Record<string, { label: string; editable: string[]; autoAllowed: boolean }> {
  return Object.fromEntries(
    Object.entries(AMBER_ACTING_ACTIONS).map(([k, a]) => [k, { label: a.label, editable: a.editable, autoAllowed: a.autoAllowed }]),
  )
}

/** How long a proposal waits for a decision before it expires. */
export const AMBER_QUEUE_TTL_MS = 3 * 24 * 60 * 60 * 1000

/** The tool argument Amber fills with why she's proposing something. Stripped
 *  before the action runs or is stored. */
export const AMBER_REASON_ARG = 'reason'

/**
 * The actor Amber's own work runs as: the company's Hub bot user, with NO
 * permission flags and no admin bypass. The catalog checks her list + modes
 * instead of flags (see runAsAmber in catalog.ts). Null when the company has no
 * bot user — then she has no account and nothing runs.
 */
export async function resolveAmberActor(admin: Admin, companyId: string): Promise<HubActor | null> {
  const botId = await getHubBotUserId(admin, companyId)
  if (!botId) return null
  const { data } = await admin.from('hub_users').select('display_name').eq('id', botId).maybeSingle()
  return {
    companyId,
    userId: botId,
    displayName: ((data as { display_name?: string | null } | null)?.display_name || '').trim() || 'Amber',
    role: null,
    isAdmin: false,
    // NOT permission: the dispatcher never checks gates for Amber (her list and
    // modes do that). These exist only so the visibility checks INSIDE her read
    // actions agree with her read list — without them review_leads and
    // get_customer_overview hide texts and calls, and a lead we already texted
    // reads as "no contact yet".
    flags: { can_access_txt: true, can_access_call_log: true, can_access_tracker: true },
    source: 'amber',
  }
}

/** This company's mode per acting action. Missing = 'off'; a read failure is
 *  'off' for everything, so a DB hiccup can never switch an action ON. */
export async function getAmberModes(admin: Admin, companyId: string): Promise<Record<string, AmberMode>> {
  const out: Record<string, AmberMode> = {}
  try {
    const { data, error } = await admin
      .from('amber_action_modes')
      .select('action, mode')
      .eq('company_id', companyId)
    if (error) return out
    for (const r of (data || []) as Array<{ action: string; mode: string }>) {
      const a = amberActingAction(r.action)
      if (!a) continue
      // 'auto' on an action that may never run unattended reads as 'approve'.
      if (r.mode === 'auto') out[r.action] = a.autoAllowed ? 'auto' : 'approve'
      else if (r.mode === 'approve') out[r.action] = 'approve'
    }
  } catch {
    // fall through: everything off
  }
  return out
}

/** Who may approve. An empty list means company admins only — never "anyone". */
export async function getAmberApproverIds(admin: Admin, companyId: string): Promise<string[]> {
  const { data } = await admin
    .from('hub_assistant_settings')
    .select('amber_approver_ids')
    .eq('company_id', companyId)
    .maybeSingle()
  const ids = (data as { amber_approver_ids?: string[] | null } | null)?.amber_approver_ids
  return Array.isArray(ids) ? ids : []
}

/** Who gets the "needs an OK" notification: the approvers, else company admins. */
async function amberNotifyIds(admin: Admin, companyId: string): Promise<string[]> {
  const ids = await getAmberApproverIds(admin, companyId)
  if (ids.length) return ids
  const { data } = await admin.from('user_profiles').select('id').eq('company_id', companyId).eq('role', 'admin')
  return ((data || []) as Array<{ id: string }>).map((r) => r.id)
}

export async function isAmberApprover(admin: Admin, companyId: string, userId: string): Promise<boolean> {
  const ids = await getAmberApproverIds(admin, companyId)
  if (ids.length) return ids.includes(userId)
  const { data } = await admin
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', userId)
    .maybeSingle()
  const p = data as { role?: string | null; company_id?: string | null } | null
  return p?.role === 'admin' && p.company_id === companyId
}

/** Split Amber's reason off the tool arguments. */
export function splitAmberReason(args: Record<string, unknown>): { reason: string; args: Record<string, unknown> } {
  const { [AMBER_REASON_ARG]: raw, ...rest } = args
  return { reason: typeof raw === 'string' ? raw.trim().slice(0, 500) : '', args: rest }
}

/**
 * Previews for the internal writes on Amber's list. Customer texts use the
 * existing builder (it resolves the real recipient and refuses opted-out
 * numbers); these three only reach coworkers, so the arguments are the preview.
 */
export const AMBER_WRITE_PREVIEWS: Record<
  string,
  (ctx: ActionContext, args: Record<string, unknown>) => Promise<{ ok: true; preview: string } | { ok: false; message: string }>
> = {
  // Previews name the EXACT room / person / board, because the actions match by
  // partial name at run time (exact first). Requiring an exact, unique match here
  // means what the approver reads is what runs. Amber's own posts go to public
  // rooms only.
  post_hub_message: async (ctx, args) => {
    const message = str(args, 'message')
    const room = str(args, 'room_name').replace(/^#/, '')
    const person = str(args, 'teammate_name')
    if (!message) return { ok: false, message: 'Provide the message text.' }
    if (message.length > 4000) return { ok: false, message: 'Keep a Hub post under about 4000 characters.' }
    if (!!room === !!person) return { ok: false, message: 'Give exactly one of room_name or teammate_name.' }
    if (room) {
      const { data } = await ctx.admin
        .from('rooms')
        .select('name')
        .eq('company_id', ctx.actor.companyId)
        .is('archived_at', null)
        .eq('is_private', false)
        .ilike('name', room.replace(/[%_]/g, ''))
      const hit = ((data || []) as Array<{ name: string | null }>).filter((r) => (r.name || '').trim().toLowerCase() === room.toLowerCase())
      if (hit.length !== 1) return { ok: false, message: `There is no public room named exactly "${room}". Use the room's full name.` }
      return { ok: true, preview: lines(`  Post in: #${(hit[0].name || room).trim()}`, `  Message: "${message}"`) }
    }
    const who = await exactTeammate(ctx, person)
    if (!who) return { ok: false, message: `No one teammate is named exactly "${person}". Use their full Hub name.` }
    return { ok: true, preview: lines(`  Direct message to: ${who}`, `  Message: "${message}"`) }
  },
  create_task: async (ctx, args) => {
    const content = str(args, 'content')
    const board = str(args, 'board_name')
    if (!content || !board) return { ok: false, message: 'A task needs a board_name and its content.' }
    if (content.length > 1000) return { ok: false, message: 'Keep the task text under about 1000 characters.' }
    const { data } = await ctx.admin
      .from('boards')
      .select('name, is_private, is_personal')
      .eq('company_id', ctx.actor.companyId)
      .ilike('name', board.replace(/[%_]/g, ''))
    const hit = ((data || []) as Array<{ name: string | null; is_private: boolean | null; is_personal: boolean | null }>).filter(
      (b) => !b.is_private && !b.is_personal && (b.name || '').trim().toLowerCase() === board.toLowerCase(),
    )
    if (hit.length !== 1) return { ok: false, message: `There is no shared board named exactly "${board}". Use the board's full name.` }
    const assignee = str(args, 'assignee_name')
    let assigneeLabel = ''
    if (assignee) {
      const who = await exactTeammate(ctx, assignee)
      if (!who) return { ok: false, message: `No one teammate is named exactly "${assignee}". Use their full Hub name.` }
      assigneeLabel = who
    }
    return {
      ok: true,
      preview: lines(
        `  Board: ${(hit[0].name || board).trim()}`,
        `  Task: "${content}"`,
        assigneeLabel ? `  Assigned to: ${assigneeLabel}` : '  Unassigned',
        str(args, 'due_date') ? `  Due: ${str(args, 'due_date')}` : '',
      ),
    }
  },
  add_contact_note: async (ctx, args) => {
    const contactId = str(args, 'contact_id')
    const note = str(args, 'note')
    if (!contactId || !note) return { ok: false, message: 'A note needs the contact_id and the note text.' }
    if (note.length > 2000) return { ok: false, message: 'Keep the note under about 2000 characters.' }
    const { data } = await ctx.admin
      .from('txt_contacts')
      .select('name, phone')
      .eq('company_id', ctx.actor.companyId)
      .eq('id', contactId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!data) return { ok: false, message: 'No contact with that id in this company.' }
    const c = data as { name: string | null; phone: string | null }
    return { ok: true, preview: lines(`  Contact: ${c.name?.trim() || c.phone || 'Unknown'}`, `  Note: "${note}"`) }
  },
}

/** The one teammate (not a bot) whose Hub name is exactly this, or null. The
 *  actions match by partial name, which picks this same person when the name is
 *  exact and unique — and refuses when it isn't. */
async function exactTeammate(ctx: ActionContext, name: string): Promise<string | null> {
  const { data } = await ctx.admin
    .from('hub_users')
    .select('display_name, is_bot')
    .eq('company_id', ctx.actor.companyId)
    .ilike('display_name', `%${name.replace(/[%_]/g, '')}%`)
    .limit(5)
  const rows = ((data || []) as Array<{ display_name: string | null; is_bot: boolean | null }>).filter((r) => !r.is_bot)
  if (rows.length !== 1 || (rows[0].display_name || '').trim().toLowerCase() !== name.toLowerCase()) return null
  return (rows[0].display_name || name).trim()
}

/**
 * Put a proposal in the approval queue and tell the approvers. Returns the text
 * Amber reads back. A pending item with the same dedupeKey means it's already
 * waiting — nothing new is queued and nobody is pinged twice.
 */
export async function queueAmberAction(
  ctx: ActionContext,
  action: string,
  args: Record<string, unknown>,
  preview: string,
  reason: string,
): Promise<string> {
  const meta = ctx.amber ?? { source: 'manual' }
  const { data, error } = await ctx.admin
    .from('amber_queue')
    .insert({
      company_id: ctx.actor.companyId,
      action,
      args,
      preview,
      reason: reason || meta.reason || '',
      source: meta.source,
      status: 'pending',
      dedupe_key: meta.dedupeKey ?? null,
      expires_at: new Date(Date.now() + AMBER_QUEUE_TTL_MS).toISOString(),
    })
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '23505') return 'That is already waiting for approval. Nothing new was queued.'
    return "I couldn't add that to the approval queue just now, so nothing was done."
  }

  const approvers = await amberNotifyIds(ctx.admin, ctx.actor.companyId).catch(() => [] as string[])
  if (approvers.length && data) {
    const label = amberActingAction(action)?.label ?? action
    // AWAITED, not fire-and-forget: a detached promise is dropped once the route
    // returns its response (memory lesson_nextjs_after_for_post_response_work) —
    // the first staging test queued fine and nobody was notified.
    await sendHubPush(approvers, {
      title: `${ctx.actor.displayName} needs an OK`,
      body: clip(reason || label, 140),
      url: '/hub/amber',
      type: 'amber_queue',
      groupKey: 'amber-queue',
    }).catch(() => {})
  }
  return (
    'QUEUED FOR APPROVAL — nothing has been done yet. A person will approve, edit or reject it in the Hub. ' +
    'Do not do it another way, and do not say it is done.'
  )
}

/** Record an action that ran on its own (mode 'auto'). Fire-and-forget. */
export function logAmberAutoRun(
  ctx: ActionContext,
  action: string,
  args: Record<string, unknown>,
  reason: string,
  result: string,
): void {
  const ok = amberActingAction(action)?.succeeded(result) ?? false
  void ctx.admin
    .from('amber_queue')
    .insert({
      company_id: ctx.actor.companyId,
      action,
      args,
      reason: reason || ctx.amber?.reason || '',
      source: ctx.amber?.source ?? 'manual',
      status: ok ? 'auto' : 'failed',
      result: clip(result, 2000),
      decided_at: new Date().toISOString(),
    })
    .then(undefined, () => {})
}
