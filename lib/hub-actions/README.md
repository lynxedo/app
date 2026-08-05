# `lib/hub-actions/` — the Hub Assistant action layer

The single definition of what an AI assistant may do inside a tenant's Hub.
Two consumers:

| Door | Entry point | Actor comes from |
|------|-------------|------------------|
| In-Hub assistant (Guardian) | `lib/hub-claude.ts` `askClaude()` | the authenticated Hub session that posted the message |
| Official Lynxedo MCP server | `app/api/mcp/route.ts` | a sha256-hashed bearer token row in `mcp_tokens` |

Full design: `Reference/PRDs/HUB_ASSISTANT_AND_MCP_PRD.md` (in the Lynxedo Drive
folder).

## The invariant

Every action executes as a `HubActor`: **one company, one user, that user's
permission flags**. There is no elevated "assistant identity". If a user can't do
it in the UI, the assistant can't do it for them.

The actor is built in `actor.ts` from a **user id only** — never from a request
body, a tool argument, or model output. Locked or deactivated users resolve to
`null`, so a Claude connection dies with the login it was made from.

## ⚠ RLS will not save you here

Actions run on `createAdminClient()`, the **service-role** client, which
**bypasses all RLS**. Every query must scope by `actor.companyId` itself. When
you look a row up by id, confirm it belongs to the actor's company before using
it — an id is not authorization.

## Adding an action

One entry in `catalog.ts`. Both doors pick it up automatically.

```ts
export const myAction: HubAction = {
  name: 'do_the_thing',
  description: '…written for the model: when to use it, what NOT to guess…',
  input_schema: { type: 'object', properties: { … }, required: […] },
  kind: 'read',            // 'read' | 'write' | 'outward'
  gate: { anyFlag: ['can_access_thing'] },   // or null for any Hub user
  consentLabel: 'do the thing',               // shown on the OAuth consent screen
  run: async (ctx, args) => '…a string the model reads back…',
}
```

Rules a new action must follow:

- **Return a string, never throw.** An instructive message ("no contact matches
  that — do not invent a phone number") is far more useful to the model than a
  generic failure. The dispatcher catches, but don't rely on it.
- **Scope every query by `ctx.actor.companyId`.**
- **Never widen a gate to `null` to "make it work."** An ungated action is
  offered to every Hub user in every tenant.
- **An `outward` action needs a preview builder** registered in
  `PREVIEW_BUILDERS`, or it fails closed rather than sending unconfirmed.

## The confirmation gate

`kind: 'outward'` means the action reaches a customer or an external system. The
dispatcher **intercepts the first call**: it resolves the real target, writes a
`hub_assistant_pending_actions` row, and returns a preview with a 6-character id.
Only `confirm_action` executes, and it re-checks company + user + expiry + status
**and the permission gate** (a staged row is not a capability token).

⚠ **The row alone is not enough, and an earlier version of this got it wrong.**
The row proves a valid preview was *created by this actor*; it does not prove a
*human approved it*. Because the model has to be told the id (it must show it to
the user), the model could originally stage in one loop iteration and confirm in
the next — which means a prompt injected into tenant data the assistant *reads*
(a customer's text, a lead form, a voicemail transcript) could send a real SMS
with nobody approving.

So confirmation is bound to something the model **cannot manufacture: a later
assistant turn.** `staged_turn_id` records the turn that staged the action, and
`confirm_action` refuses a row staged in the *current* turn. Guardian only starts
a turn when a human sends a message, so a confirm necessarily follows a real
person replying.

Over MCP there are no turn boundaries we can see — every `tools/call` is its own
request — so the binding can't protect that door. Customer-facing actions are
therefore **off over MCP** unless the company sets `allow_outward_over_mcp`,
accepting that approval then rests on their Claude client's own per-tool prompt.

If you add an outward action, do not "simplify" this by returning the id and
trusting the model to wait.

Consume-then-execute uses `.eq('status','pending')` as a compare-and-set, so two
overlapping confirms can't both send.

## Gates

`actorPassesGate` in `types.ts`. Admins bypass **flag** checks (matching
`requireAdminArea`'s `isSuperAdmin || hasGrant`); admins never bypass
confirmation. Gates are checked when **listing** tools *and again at execute
time* — listing and running are separate requests and a flag can be revoked in
between.

⚠ An empty `allFlags: []` would pass everyone (`[].every()` is `true`). It is
explicitly denied; don't "fix" that check.
