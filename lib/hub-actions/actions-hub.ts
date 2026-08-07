// Internal Hub messaging action: post_hub_message.
//
// Posts as the ASSISTANT, with a trailing line naming who asked for it.
//
// It used to post as the actor, on the reasoning that a teammate reading the
// room should see who wanted the message sent. The problem is what the assistant
// reads: customer SMS, lead-form submissions, contact notes and voicemail
// transcripts all reach it as tool results, and all are written by people
// outside the company. Text shaped like an instruction inside any of them could
// produce a Hub message under a real colleague's name that they never wrote —
// the name honestly theirs, the words not. Posting as the bot turns the worst
// case from "a named colleague announces new bank details" into "the assistant
// says something odd", which reads as a nuisance rather than a convincing
// internal phish. The attribution line keeps the honest case honest.
//
// Membership is still verified before posting, so the assistant can't be used to
// reach a private room the user isn't in.
//
// ⚠ The company's Hub bot is required. A company with no bot row gets a refusal
// rather than a fall back to posting as the actor — falling back would reinstate
// exactly the gap above, silently, for the tenants least likely to notice.

import { broadcastMessageInserted } from '@/lib/hub-message-broadcast'
import { getHubBotUserId, postGuardianToRoom, postGuardianToUserDm } from '@/lib/guardian-post'
import type { ActionContext, HubAction } from './types'
import { str } from './types'
import { clip, lines } from './format'

/** Rooms the actor is a member of (private or not) plus open company rooms. */
async function actorRooms(ctx: ActionContext): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
  const { data: rooms } = await ctx.admin
    .from('rooms')
    .select('id, name, is_private')
    .eq('company_id', ctx.actor.companyId)
    .is('archived_at', null)
  const all = (rooms || []) as Array<{ id: string; name: string | null; is_private: boolean | null }>

  const { data: memberships } = await ctx.admin
    .from('room_members')
    .select('room_id')
    .eq('user_id', ctx.actor.userId)
  const memberOf = new Set(((memberships || []) as Array<{ room_id: string }>).map((m) => m.room_id))

  // A private room requires membership. A public room is postable by any
  // teammate — matching how the Hub itself behaves.
  return all
    .filter((r) => !r.is_private || memberOf.has(r.id))
    .map((r) => ({ id: r.id, name: (r.name || 'unnamed').trim(), isPrivate: r.is_private === true }))
}

/**
 * The message body plus one short attribution line. Deliberately a suffix rather
 * than a wrapper ("Ben asked me to post this: …") — a wrapper reads as clumsy
 * around every message, and buries the content one clause deep.
 */
function withAttribution(message: string, actorName: string, verb: 'posted' | 'sent'): string {
  const who = (actorName || '').trim() || 'a teammate'
  return `${message}\n\n— ${verb} at ${who}'s request`
}

/** Realtime fan-out for a message the guardian-post helpers inserted. */
async function broadcastPostedMessage(ctx: ActionContext, messageId: string, senderId: string) {
  const { data } = await ctx.admin
    .from('messages')
    .select('room_id, conversation_id')
    .eq('id', messageId)
    .maybeSingle()
  const row = (data || {}) as { room_id: string | null; conversation_id: string | null }
  void broadcastMessageInserted({
    messageId,
    roomId: row.room_id ?? null,
    conversationId: row.conversation_id ?? null,
    parentId: null,
    senderId,
  }).catch(() => {})
}

export const postHubMessageAction: HubAction = {
  name: 'post_hub_message',
  description:
    'Post a message inside the Hub — either to a room (by name) or as a direct message to one teammate ' +
    '(by name). This is INTERNAL only: it reaches coworkers, never customers. The message is posted ' +
    'under the assistant\'s own name, with a line noting it was posted at your request. ' +
    'Give exactly one of room_name or teammate_name.',
  input_schema: {
    type: 'object',
    properties: {
      room_name: { type: 'string', description: 'The room to post in, by name (e.g. "office").' },
      teammate_name: { type: 'string', description: 'A teammate to DM, by name.' },
      message: { type: 'string', description: 'The message text.' },
    },
    required: ['message'],
  },
  kind: 'write',
  gate: null,
  consentLabel: 'post messages to your team in the Hub',
  run: async (ctx, args) => {
    const message = str(args, 'message')
    const roomName = str(args, 'room_name')
    const teammateName = str(args, 'teammate_name')
    if (!message) return 'Provide the message text.'
    if (message.length > 4000) return 'That message is too long for a Hub post — keep it under about 4000 characters.'
    if (!roomName && !teammateName) return 'Say whether this goes to a room (room_name) or a teammate (teammate_name).'
    if (roomName && teammateName) return 'Give only one of room_name or teammate_name, not both.'

    // Resolved once, up front: without a bot identity for this company there is
    // no safe sender, and every path below needs the id for the realtime event.
    const botUserId = await getHubBotUserId(ctx.admin, ctx.actor.companyId)
    if (!botUserId) {
      return (
        'This company has no assistant account set up in the Hub yet, so I can\'t post as myself. ' +
        'An admin can set one up in Admin → AI → Assistant.'
      )
    }

    if (roomName) {
      const rooms = await actorRooms(ctx)
      const needle = roomName.toLowerCase().replace(/^#/, '')
      let matches = rooms.filter((r) => r.name.toLowerCase() === needle)
      if (matches.length === 0) matches = rooms.filter((r) => r.name.toLowerCase().includes(needle))
      if (matches.length === 0) {
        return `No room you can post in matches "${roomName}". Rooms available to you: ${rooms.map((r) => r.name).join(', ') || 'none'}.`
      }
      if (matches.length > 1) {
        return `"${roomName}" matches ${matches.map((r) => r.name).join(', ')}. Ask which one.`
      }
      const room = matches[0]

      const messageId = await postGuardianToRoom(
        room.id,
        withAttribution(message, ctx.actor.displayName, 'posted'),
        { admin: ctx.admin },
      )
      if (!messageId) return "I couldn't post that message just now."

      await broadcastPostedMessage(ctx, messageId, botUserId)

      return `Posted in #${room.name}, from me and noted as at your request: "${clip(message, 120)}"`
    }

    // DM path — resolve the teammate, then send from the assistant's own DM with
    // them. Note this is the assistant↔recipient conversation, not the actor's:
    // a bot message dropped into someone else's 1:1 thread would be a third
    // party appearing in a two-person conversation.
    const { data: people } = await ctx.admin
      .from('hub_users')
      .select('id, display_name, is_bot')
      .eq('company_id', ctx.actor.companyId)
      .ilike('display_name', `%${teammateName.replace(/[%_]/g, '')}%`)
      .limit(5)
    const rows = ((people || []) as Array<{ id: string; display_name: string | null; is_bot: boolean | null }>).filter(
      // Bots excluded as well as the actor: "DM Amber" would otherwise match the
      // assistant itself, and postGuardianToUserDm refuses to DM the bot — the
      // user would get a generic failure instead of being told no such teammate.
      (p) => p.id !== ctx.actor.userId && p.is_bot !== true,
    )
    if (rows.length === 0) return `No teammate named "${teammateName}" in this company.`
    if (rows.length > 1) {
      return `"${teammateName}" matches ${rows.map((p) => p.display_name).join(', ')}. Ask which one.`
    }
    const recipient = rows[0]

    const messageId = await postGuardianToUserDm(
      ctx.actor.companyId,
      recipient.id,
      withAttribution(message, ctx.actor.displayName, 'sent'),
      { admin: ctx.admin },
    )
    if (!messageId) return "I couldn't send that direct message just now."

    await broadcastPostedMessage(ctx, messageId, botUserId)

    return lines(
      `Sent ${(recipient.display_name || 'them').trim()} a direct message from me, noted as at your request:`,
      `"${clip(message, 160)}"`,
    )
  },
}
