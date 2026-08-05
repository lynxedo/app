// The confirmation gate for outward actions.
//
// An `outward` action (today: texting a customer) never sends on its first call.
// It resolves the REAL target, writes a pending row, and returns a preview the
// assistant must show the human. Only confirm_action — with the short id from
// that row — actually sends.
//
// Why this lives server-side and not in the prompt: a prompt instruction can be
// talked around by injected content in a page, an email, or a customer's text.
// A row that must exist, belong to this company AND this user, be unexpired, and
// be unconsumed cannot be talked around. The model cannot invent a valid id.

import { randomBytes } from 'crypto'
import type { Admin, HubActor } from './types'

/** How long a previewed action stays confirmable. */
const PENDING_TTL_MS = 15 * 60 * 1000

// Crockford-ish alphabet: no I/L/O/U/0/1 so a human reading the id back can't
// mistype it. 6 chars from 32 symbols ≈ 1 in a billion — and guessing is further
// bounded by the company+user+status filter and the 15-minute window.
const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

function makeShortId(): string {
  const bytes = randomBytes(6)
  let out = ''
  for (let i = 0; i < 6; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  return out
}

/**
 * Stage an outward action and return the preview text for the model to show.
 * `preview` should name the real recipient and the exact content — the whole
 * point is that the human approves what will actually happen, not a paraphrase.
 */
export async function stageOutwardAction(
  admin: Admin,
  actor: HubActor,
  action: string,
  args: Record<string, unknown>,
  preview: string,
  turnId: string,
): Promise<string> {
  const shortId = makeShortId()
  const { error } = await admin.from('hub_assistant_pending_actions').insert({
    short_id: shortId,
    company_id: actor.companyId,
    user_id: actor.userId,
    action,
    args,
    preview,
    source: actor.source,
    status: 'pending',
    staged_turn_id: turnId,
    expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
  })
  if (error) {
    return "I couldn't stage that for confirmation just now, so nothing has been sent. Please try again."
  }
  return (
    `READY TO SEND — nothing has been sent yet.\n${preview}\n\n` +
    `Show this to the user exactly as written and ask them to confirm. ` +
    `If they agree, call confirm_action with id="${shortId}". ` +
    `If they change anything, start over with a new preview. ` +
    `This expires in 15 minutes. Never claim it was sent until confirm_action succeeds.`
  )
}

export type ConsumedAction =
  | { ok: true; action: string; args: Record<string, unknown> }
  | { ok: false; message: string }

/**
 * Claim a staged action for execution. Marks it consumed BEFORE returning, with
 * the status guard in the WHERE clause — so two overlapping confirms can't both
 * win and double-send. Scoped to the actor's own company AND user id: one
 * teammate can never confirm something another teammate staged.
 */
export async function consumePendingAction(
  admin: Admin,
  actor: HubActor,
  shortId: string,
  turnId: string,
): Promise<ConsumedAction> {
  const id = shortId.trim().toUpperCase()
  if (!/^[0-9A-Z]{6}$/.test(id)) {
    return { ok: false, message: `"${shortId}" isn't a valid confirmation id. Nothing was sent.` }
  }

  const { data: row } = await admin
    .from('hub_assistant_pending_actions')
    .select('id, action, args, status, expires_at, staged_turn_id')
    .eq('short_id', id)
    .eq('company_id', actor.companyId)
    .eq('user_id', actor.userId)
    .maybeSingle()

  if (!row) {
    return {
      ok: false,
      message: `I couldn't find a pending action with id "${id}" for you. Nothing was sent — build the request again from scratch.`,
    }
  }
  const r = row as {
    id: string
    action: string
    args: Record<string, unknown>
    status: string
    expires_at: string
    staged_turn_id: string | null
  }

  // THE HUMAN-IN-THE-LOOP CHECK. Refusing a confirm from the same turn that staged
  // it is what makes this more than a prompt rule: the model can read the id (it
  // has to, to show the user), but it cannot manufacture a new turn — only a
  // person sending another message does that. Without this, injected text sitting
  // in tenant data could drive stage-then-confirm inside one loop.
  if (r.staged_turn_id && r.staged_turn_id === turnId) {
    return {
      ok: false,
      message:
        'Nothing was sent. This needs the person to actually approve it first: show them the preview, ' +
        'wait for their reply, and only confirm after they say yes in a new message. You cannot confirm ' +
        'something you staged a moment ago in this same response.',
    }
  }

  if (r.status === 'consumed') {
    return { ok: false, message: 'That action was already carried out. It has NOT been repeated.' }
  }
  if (r.status !== 'pending') {
    return { ok: false, message: `That action is no longer pending (${r.status}). Nothing was sent.` }
  }
  if (Date.parse(r.expires_at) < Date.now()) {
    await admin.from('hub_assistant_pending_actions').update({ status: 'expired' }).eq('id', r.id)
    return {
      ok: false,
      message: 'That confirmation expired (they run out after 15 minutes). Nothing was sent — offer to redo it.',
    }
  }

  // Consume-then-execute. The .eq('status','pending') makes this a compare-and-set:
  // whichever request flips the row first is the only one that proceeds.
  const { data: claimed } = await admin
    .from('hub_assistant_pending_actions')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .eq('id', r.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (!claimed) {
    return { ok: false, message: 'That action was just carried out by another request. It has NOT been repeated.' }
  }

  return { ok: true, action: r.action, args: r.args ?? {} }
}
