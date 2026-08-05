// Internal Hub messaging action: post_hub_message.
//
// Posts as the ACTOR, not as the bot — a teammate reading the room sees who
// actually asked for it. Membership is verified before posting, so the assistant
// can't be used to reach a private room the user isn't in.

import { broadcastMessageInserted } from '@/lib/hub-message-broadcast'
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

export const postHubMessageAction: HubAction = {
  name: 'post_hub_message',
  description:
    'Post a message inside the Hub — either to a room (by name) or as a direct message to one teammate ' +
    '(by name). This is INTERNAL only: it reaches coworkers, never customers. The message is posted ' +
    'under your own name. Give exactly one of room_name or teammate_name.',
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
    if (!roomName && !teammateName) return 'Say whether this goes to a room (room_name) or a teammate (teammate_name).'
    if (roomName && teammateName) return 'Give only one of room_name or teammate_name, not both.'

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

      const { data: inserted, error } = await ctx.admin
        .from('messages')
        .insert({
          company_id: ctx.actor.companyId,
          room_id: room.id,
          sender_id: ctx.actor.userId,
          content: message,
        })
        .select('id')
        .maybeSingle()
      if (error || !inserted) return "I couldn't post that message just now."

      void broadcastMessageInserted({
        messageId: (inserted as { id: string }).id,
        roomId: room.id,
        conversationId: null,
        parentId: null,
        senderId: ctx.actor.userId,
      }).catch(() => {})

      return `Posted in #${room.name} as you: "${clip(message, 120)}"`
    }

    // DM path — resolve the teammate, then find or create the 1:1 conversation.
    const { data: people } = await ctx.admin
      .from('hub_users')
      .select('id, display_name, is_bot')
      .eq('company_id', ctx.actor.companyId)
      .ilike('display_name', `%${teammateName.replace(/[%_]/g, '')}%`)
      .limit(5)
    const rows = ((people || []) as Array<{ id: string; display_name: string | null; is_bot: boolean | null }>).filter(
      (p) => p.id !== ctx.actor.userId,
    )
    if (rows.length === 0) return `No teammate named "${teammateName}" in this company.`
    if (rows.length > 1) {
      return `"${teammateName}" matches ${rows.map((p) => p.display_name).join(', ')}. Ask which one.`
    }
    const recipient = rows[0]

    // Find an existing 1:1 by intersecting both users' conversations and
    // requiring exactly two members — the same rule lib/guardian-post uses.
    const { data: mine } = await ctx.admin
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', ctx.actor.userId)
    const myIds = new Set(((mine || []) as Array<{ conversation_id: string }>).map((m) => m.conversation_id))
    const { data: theirs } = await ctx.admin
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', recipient.id)
    const shared = ((theirs || []) as Array<{ conversation_id: string }>)
      .map((m) => m.conversation_id)
      .filter((id) => myIds.has(id))

    // Only consider conversations that belong to THIS company. A user who was
    // moved between companies can still have membership rows pointing at their
    // old tenant's conversations; posting into one of those would cross tenants.
    let candidates = shared
    if (candidates.length) {
      const { data: owned } = await ctx.admin
        .from('conversations')
        .select('id')
        .eq('company_id', ctx.actor.companyId)
        .in('id', candidates.slice(0, 100))
      const ownedIds = new Set(((owned || []) as Array<{ id: string }>).map((c) => c.id))
      candidates = candidates.filter((id) => ownedIds.has(id))
    }

    let conversationId: string | null = null
    for (const id of candidates) {
      const { count } = await ctx.admin
        .from('conversation_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('conversation_id', id)
      if (count === 2) {
        conversationId = id
        break
      }
    }

    if (!conversationId) {
      const { data: conv, error: convErr } = await ctx.admin
        .from('conversations')
        .insert({ company_id: ctx.actor.companyId })
        .select('id')
        .maybeSingle()
      if (convErr || !conv) return "I couldn't start that direct message."
      conversationId = (conv as { id: string }).id
      const { error: memberErr } = await ctx.admin.from('conversation_members').insert([
        { conversation_id: conversationId, user_id: ctx.actor.userId },
        { conversation_id: conversationId, user_id: recipient.id },
      ])
      if (memberErr) return "I couldn't set up that direct message."
    }

    const { data: inserted, error } = await ctx.admin
      .from('messages')
      .insert({
        company_id: ctx.actor.companyId,
        conversation_id: conversationId,
        sender_id: ctx.actor.userId,
        content: message,
      })
      .select('id')
      .maybeSingle()
    if (error || !inserted) return "I couldn't send that direct message just now."

    void broadcastMessageInserted({
      messageId: (inserted as { id: string }).id,
      roomId: null,
      conversationId,
      parentId: null,
      senderId: ctx.actor.userId,
    }).catch(() => {})

    return lines(
      `Sent a direct message to ${(recipient.display_name || 'them').trim()} as you:`,
      `"${clip(message, 160)}"`,
    )
  },
}
