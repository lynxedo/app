// Hub Assistant action layer — public surface.
//
// Consumers:
//   lib/hub-claude.ts    → Guardian, the in-Hub assistant
//   app/api/mcp/route.ts → the official Lynxedo MCP server
//
// See Reference/PRDs/HUB_ASSISTANT_AND_MCP_PRD.md.

export type {
  HubActor,
  HubAction,
  ActionContext,
  ActionKind,
  ActionGate,
  ActorSource,
  Admin,
} from './types'
export { actorPassesGate } from './types'

export { resolveHubActor } from './actor'

export type { AssistantSettings } from './settings'
export { getAssistantSettings, assistantAvailableFor, logAssistantEvent } from './settings'

export {
  allActionMeta,
  consentSummary,
  hubActionTools,
  isHubActionName,
  listHubActions,
  runHubAction,
} from './catalog'
