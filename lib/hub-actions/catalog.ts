// The action catalog + dispatcher.
//
// This is the security boundary. Two rules it must never break:
//
//  1. An action the actor fails is not OFFERED and cannot be RUN. The gate is
//     checked when building the tool list AND again at execute time — listing
//     and running are separate requests, and a permission can be revoked in
//     between.
//  2. An `outward` action's first call never executes. The dispatcher intercepts
//     it, stages a preview, and only confirm_action can carry it out. This is
//     enforced here, in code — not by asking the model nicely in a prompt.

import type Anthropic from '@anthropic-ai/sdk'
import type { ActionContext, ActionGroup, HubAction, HubActor } from './types'
import { actorPassesGate, str } from './types'
import type { AssistantSettings } from './settings'
import { consumePendingAction, stageOutwardAction } from './pending'

import { addContactNoteAction, customerOverviewAction, findContactAction } from './actions-contacts'
import { getScheduleAction } from './actions-schedule'
import { previewCustomerText, searchTextsAction, sendCustomerTextAction } from './actions-txt'
import { callActivityAction } from './actions-calls'
import { listLeadsAction, upsertLeadAction } from './actions-tracker'
import { createTaskAction, listTasksAction } from './actions-boards'
import { postHubMessageAction } from './actions-hub'
import { JOBBER_ACTIONS, JOBBER_PREVIEW_BUILDERS } from './actions-jobber'

/**
 * confirm_action carries out something previously previewed. It is defined here
 * rather than in an action file because it needs the dispatcher to re-enter.
 */
const CONFIRM_ACTION_NAME = 'confirm_action'

const confirmAction: HubAction = {
  name: CONFIRM_ACTION_NAME,
  description:
    'Carry out an action that was previewed earlier and that the user has now explicitly approved. ' +
    'Pass the id from the preview. Only call this after the user has clearly said yes to that exact ' +
    'preview — never to "check" whether an id is valid, and never on your own initiative.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The confirmation id from the preview (6 characters).' },
    },
    required: ['id'],
  },
  kind: 'write',
  gate: null,
  consentLabel: 'carry out actions you have approved',
  // Never called directly — runHubAction handles it so it can re-dispatch.
  run: async () => 'confirm_action must be handled by the dispatcher.',
}

/** Every action, in a stable order (the tools array feeds a cached prompt prefix). */
const ALL_ACTIONS: HubAction[] = [
  findContactAction,
  customerOverviewAction,
  getScheduleAction,
  searchTextsAction,
  callActivityAction,
  listLeadsAction,
  upsertLeadAction,
  listTasksAction,
  createTaskAction,
  addContactNoteAction,
  postHubMessageAction,
  sendCustomerTextAction,
  ...JOBBER_ACTIONS,
  confirmAction,
].sort((a, b) => a.name.localeCompare(b.name))

const BY_NAME = new Map(ALL_ACTIONS.map((a) => [a.name, a]))

/** Preview builders for outward actions, keyed by action name. */
const PREVIEW_BUILDERS: Record<
  string,
  (ctx: ActionContext, args: Record<string, unknown>) => Promise<{ ok: true; preview: string } | { ok: false; message: string }>
> = {
  [sendCustomerTextAction.name]: previewCustomerText,
  ...JOBBER_PREVIEW_BUILDERS,
}

export function isHubActionName(name: string): boolean {
  return BY_NAME.has(name)
}

/** Section this action belongs to in the admin allow-list. */
function groupOf(a: HubAction): ActionGroup {
  return a.group ?? 'hub'
}

/**
 * Is this action switched on for the company? Reads default ON (an admin turns
 * them off); consequential actions default OFF and must be ticked on. That split
 * is why there are two arrays instead of one.
 */
function isActionAllowedByCompany(a: HubAction, settings: AssistantSettings): boolean {
  const defaultOn = a.defaultOn !== false
  return defaultOn
    ? !settings.disabledActions.includes(a.name)
    : settings.enabledActions.includes(a.name)
}

/**
 * Actions that reach outside the Hub or change the real schedule. These are the
 * ones that can require confirmation, and the ones never allowed over MCP unless
 * a company opts in — gated on the KIND, not on whether confirmation happens to be
 * switched on, so relaxing confirmation can't quietly open the MCP door too.
 */
function isConsequential(a: HubAction): boolean {
  return a.kind === 'outward' || a.kind === 'jobber_write'
}

function confirmationRequired(a: HubAction, settings: AssistantSettings): boolean {
  if (a.kind === 'outward') return settings.requireConfirmation
  if (a.kind === 'jobber_write') return settings.requireJobberConfirmation
  return false
}

/** Every action, for the admin panel's per-section checklist. */
export function allActionMeta(): Array<{
  name: string
  kind: string
  group: ActionGroup
  defaultOn: boolean
  consentLabel: string
}> {
  return ALL_ACTIONS.map((a) => ({
    name: a.name,
    kind: a.kind,
    group: groupOf(a),
    defaultOn: a.defaultOn !== false,
    consentLabel: a.consentLabel,
  }))
}

/**
 * The actions this actor may use right now. Filtered by permission gate and the
 * company's disabled list. confirm_action is only offered when at least one
 * outward action is available — otherwise there is nothing to confirm.
 */
export function listHubActions(actor: HubActor, settings: AssistantSettings): HubAction[] {
  const available = ALL_ACTIONS.filter((a) => {
    if (a.name === CONFIRM_ACTION_NAME) return true
    if (!isActionAllowedByCompany(a, settings)) return false
    // Don't advertise a consequential action over MCP when this company hasn't
    // allowed it — offering a tool that always refuses is just noise.
    if (isConsequential(a) && actor.source === 'mcp' && !settings.allowOutwardOverMcp) return false
    return actorPassesGate(actor, a.gate)
  })

  // confirm_action is only useful when something can actually need confirming.
  const anyConfirmable = available.some((a) => isConsequential(a) && confirmationRequired(a, settings))
  return anyConfirmable ? available : available.filter((a) => a.name !== CONFIRM_ACTION_NAME)
}

/** Anthropic tool definitions for a set of actions. */
export function hubActionTools(actions: HubAction[]): Anthropic.Tool[] {
  return actions.map((a) => ({
    name: a.name,
    description: a.description,
    input_schema: a.input_schema,
  }))
}

/** A short description of what this actor's Claude will be able to do — for the OAuth consent screen. */
export function consentSummary(actor: HubActor, settings: AssistantSettings): string[] {
  return listHubActions(actor, settings)
    .filter((a) => a.name !== CONFIRM_ACTION_NAME)
    .map((a) => a.consentLabel)
}

/**
 * Execute one action by name. Never throws — every failure path returns a string
 * the model can read and recover from.
 */
export async function runHubAction(
  ctx: ActionContext,
  settings: AssistantSettings,
  name: string,
  input: unknown,
): Promise<string> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  try {
    if (name === CONFIRM_ACTION_NAME) {
      return await runConfirm(ctx, settings, args)
    }

    const action = BY_NAME.get(name)
    if (!action) return `Unknown action "${name}".`

    // Re-check the gate at execute time (defense in depth: listing and running
    // are separate requests, and a flag can be revoked in between).
    const denied = denyReason(ctx.actor, settings, action)
    if (denied) return denied

    if (isConsequential(action)) {
      // Over MCP there are no turn boundaries we can see, so the same-turn
      // confirmation binding can't protect that door — approval would rest
      // entirely on the connected client's own UI. Off unless opted into.
      if (ctx.actor.source === 'mcp' && !settings.allowOutwardOverMcp) {
        return (
          `Actions that reach customers or change the Jobber schedule are turned off for connected ` +
          `Claude apps in this company, so "${action.name}" can't run here and nothing happened. Tell the ` +
          `user they can do it in the Hub itself, or an admin can allow it in Admin → AI → Assistant.`
        )
      }
      if (confirmationRequired(action, settings)) {
        return await stagePreview(ctx, action, args)
      }
    }

    return await action.run(ctx, args)
  } catch (err) {
    console.warn('[hub-actions] action failed', name, err)
    return `That didn't complete because of an internal error, so assume nothing happened. Tell the user it failed rather than guessing at a result.`
  }
}

/** Why this actor can't run this action right now, or null if they can. */
function denyReason(actor: HubActor, settings: AssistantSettings, action: HubAction): string | null {
  if (!isActionAllowedByCompany(action, settings)) {
    return `The "${action.name}" action isn't switched on for this company. Tell the user an admin can enable it in Admin → AI → Assistant.`
  }
  if (!actorPassesGate(actor, action.gate)) {
    return `You don't have permission to use "${action.name}" in Lynxedo, so I can't do that for you. An admin can grant it in Admin → People.`
  }
  return null
}

/** Build + stage the preview for an outward action. */
async function stagePreview(
  ctx: ActionContext,
  action: HubAction,
  args: Record<string, unknown>,
): Promise<string> {
  const builder = PREVIEW_BUILDERS[action.name]
  if (!builder) {
    // A new outward action without a preview builder must fail closed rather than
    // send unconfirmed.
    return `"${action.name}" needs confirmation but has no preview available, so I can't run it. This is a configuration gap — tell the user to report it.`
  }
  const built = await builder(ctx, args)
  if (!built.ok) return built.message
  return await stageOutwardAction(ctx.admin, ctx.actor, action.name, args, built.preview, ctx.turnId)
}

/** Consume a pending confirmation and run the real action. */
async function runConfirm(
  ctx: ActionContext,
  settings: AssistantSettings,
  args: Record<string, unknown>,
): Promise<string> {
  const id = str(args, 'id')
  if (!id) return 'Provide the confirmation id from the preview.'

  const claimed = await consumePendingAction(ctx.admin, ctx.actor, id, ctx.turnId)
  if (!claimed.ok) return claimed.message

  const action = BY_NAME.get(claimed.action)
  if (!action) return `That confirmation refers to an action ("${claimed.action}") that no longer exists.`

  // Permissions are re-checked HERE too: the staged row is not a capability
  // token. If the user lost the permission between preview and confirm, the
  // send must not go through on the strength of the older check.
  const denied = denyReason(ctx.actor, settings, action)
  if (denied) return denied

  return await action.run(ctx, claimed.args)
}
