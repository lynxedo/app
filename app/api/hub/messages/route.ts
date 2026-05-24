import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { askClaude } from '@/lib/hub-claude'
import { markActive } from '@/lib/hub-activity'
import { bridgeHubMessageToChatSynx } from '@/lib/chat-synx'

const MESSAGE_SELECT = `
  id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from, source,
  sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
  reactions (message_id, user_id, emoji),
  files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)
`

const CLAUDE_BOT_ID = '00000000-0000-0000-0001-000000000001'

const CLAUDE_SYSTEM_PROMPT = `You are the Heroes Lawn Care team assistant, built into the company's internal messaging app (Hub).
Heroes Lawn Care is a lawn care and landscaping company in the Houston/Cypress, TX area.
You have access to Jobber (the company's scheduling and CRM system) and Captivated (their SMS messaging platform) via integrated tools.
Help the team with scheduling questions, client lookups, job status, job notes, customer communications, and general team questions.
Be concise and practical. Address the team member's question directly. Use plain text — no markdown headers.`

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const roomId = searchParams.get('room_id')
  if (!roomId) return NextResponse.json({ error: 'room_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('room_id', roomId)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch original messages for any forwarded messages — use admin client to bypass
  // RLS so originals from other rooms are always readable in the forwarded banner
  const forwardedIds = (data ?? []).map((m: { forwarded_from: string | null }) => m.forwarded_from).filter(Boolean) as string[]
  let forwardedMap: Record<string, { id: string; content: string; sender: { display_name: string } | null; room_id: string | null; conversation_id: string | null }> = {}
  if (forwardedIds.length > 0) {
    const { data: originals } = await createAdminClient()
      .from('messages')
      .select('id, content, room_id, conversation_id, sender:hub_users!sender_id (display_name)')
      .in('id', forwardedIds)
    for (const o of originals ?? []) {
      const orig = o as { id: string; content: string; room_id: string | null; conversation_id: string | null; sender: { display_name: string } | { display_name: string }[] | null }
      const sender = Array.isArray(orig.sender) ? orig.sender[0] : orig.sender
      forwardedMap[orig.id] = { ...orig, sender }
    }
  }

  const messages = (data ?? []).map((m: { forwarded_from: string | null; [key: string]: unknown }) => ({
    ...m,
    forwarded_original: m.forwarded_from ? forwardedMap[m.forwarded_from] ?? null : null,
  }))

  return NextResponse.json({ messages })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Smart presence: bump last_active_at on every send (fire-and-forget).
  markActive(user.id)

  const body = await request.json()
  const { room_id, conversation_id, parent_id, content, files, forwarded_from } = body

  const hasFiles = Array.isArray(files) && files.length > 0
  const hasContent = content?.trim()
  const isForward = !!forwarded_from
  if (!hasContent && !hasFiles && !isForward) return NextResponse.json({ error: 'content, files, or forwarded_from required' }, { status: 400 })
  if (!room_id && !conversation_id) return NextResponse.json({ error: 'room_id or conversation_id required' }, { status: 400 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: msg, error } = await supabase
    .from('messages')
    .insert({
      company_id: profile.company_id,
      room_id: room_id ?? null,
      conversation_id: conversation_id ?? null,
      parent_id: parent_id ?? null,
      sender_id: user.id,
      content: hasContent ? content.trim() : '',
      forwarded_from: forwarded_from ?? null,
    })
    .select('id, content, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Advance the sender's own read receipt so this message doesn't make
  // their own room/DM appear unread on a sidebar refresh. The GET path
  // marks a room/conv unread whenever the latest message is newer than
  // the user's last_read_at — without this, the sender's send is "newer
  // than I last read" until they re-open the conversation.
  // Only top-level messages count toward unread state.
  if (!parent_id && (room_id || conversation_id)) {
    const receipt: {
      company_id: string
      user_id: string
      last_read_at: string
      room_id?: string
      conversation_id?: string
    } = {
      company_id: profile.company_id,
      user_id: user.id,
      last_read_at: msg.created_at,
    }
    if (room_id) receipt.room_id = room_id
    if (conversation_id) receipt.conversation_id = conversation_id
    await supabase
      .from('hub_read_receipts')
      .upsert(receipt, { onConflict: room_id ? 'user_id,room_id' : 'user_id,conversation_id' })
  }

  // Auto-unarchive the DM for all members on new activity
  if (conversation_id) {
    const unarchiveAdmin = createAdminClient()
    await unarchiveAdmin
      .from('conversation_members')
      .update({ archived_at: null })
      .eq('conversation_id', conversation_id)
      .not('archived_at', 'is', null)
  }

  if (hasFiles) {
    await supabase.from('files').insert(
      files.map((f: { storage_path: string; filename: string; mime_type: string; size_bytes: number; width_px?: number | null; height_px?: number | null }) => ({
        company_id: profile.company_id,
        message_id: msg.id,
        uploader_id: user.id,
        storage_path: f.storage_path,
        filename: f.filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        width_px: f.width_px ?? null,
        height_px: f.height_px ?? null,
      }))
    )
  }

  // All push recipient lookups use adminClient to bypass RLS
  const pushAdmin = createAdminClient()

  // Fetch sender display name + avatar once — used by push paths below and Chat Synx bridge
  const { data: senderProfile } = await pushAdmin
    .from('hub_users')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single()
  const senderName = senderProfile?.display_name ?? 'Someone'

  // Push for @mentions — pass room_id so push logic can check mute prefs
  const textToScan = content ?? ''
  const mentionedFirstNames = [...textToScan.matchAll(/@(\w+)/g)].map((m: RegExpMatchArray) => m[1].toLowerCase())
  if (mentionedFirstNames.length > 0) {
    const { data: allUsers } = await pushAdmin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', profile.company_id)
      .not('id', 'eq', user.id)

    const matchedIds = (allUsers ?? [])
      .filter((u: { id: string; display_name: string }) =>
        mentionedFirstNames.some(n => u.display_name.split(' ')[0].toLowerCase() === n)
      )
      .map((u: { id: string }) => u.id)

    if (matchedIds.length > 0) {
      const destination = room_id ? `/hub/${room_id}` : `/hub/pm/${conversation_id}`
      sendHubPush(matchedIds, {
        title: `${senderName} mentioned you`,
        body: textToScan.trim().slice(0, 120),
        url: destination,
      }, { isMention: true, roomId: room_id ?? null }).catch((err: Error) =>
        console.error('[messages] mention push failed:', err.message)
      )
    }
  }

  // @room — force-notify all room members (bypasses mentions-only pref, respects muted)
  if (room_id && !parent_id && textToScan.toLowerCase().includes('@room')) {
    const { data: roomMeta } = await pushAdmin.from('rooms').select('name').eq('id', room_id).single()
    const { data: allHubUsers } = await pushAdmin
      .from('hub_users')
      .select('id')
      .eq('company_id', profile.company_id)
      .neq('id', user.id)
      .eq('is_bot', false)
    const roomMemberIds = (allHubUsers ?? []).map((u: { id: string }) => u.id)
    if (roomMemberIds.length > 0) {
      sendHubPush(roomMemberIds, {
        title: `📢 @room — #${roomMeta?.name ?? 'room'} — ${senderName}`,
        body: textToScan.trim().slice(0, 120),
        url: `/hub/${room_id}`,
      }, { isMention: true, roomId: room_id }).catch((err: Error) =>
        console.error('[messages] @room push failed:', err.message)
      )
    }
  }

  // Push for new DM messages (top-level only) — notify all other participants
  if (conversation_id && !parent_id) {
    const { data: members } = await pushAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversation_id)
      .neq('user_id', user.id)

    const recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id)
    if (recipientIds.length > 0) {
      sendHubPush(recipientIds, {
        title: senderName,
        body: hasContent ? content.trim().slice(0, 120) : '📎 Sent an attachment',
        url: `/hub/pm/${conversation_id}`,
      }, { isDm: true }).catch((err: Error) =>
        console.error('[messages] DM push failed:', err.message)
      )
    }
  }

  // Push for new room messages (top-level only) — notify all company members
  // sendHubPush filters by each user's notification prefs (muted/mentions/all)
  if (room_id && !parent_id) {
    const { data: roomData } = await pushAdmin
      .from('rooms')
      .select('name')
      .eq('id', room_id)
      .single()

    const { data: allHubUsers } = await pushAdmin
      .from('hub_users')
      .select('id')
      .eq('company_id', profile.company_id)
      .neq('id', user.id)
      .eq('is_bot', false)

    const roomMemberIds = (allHubUsers ?? []).map((u: { id: string }) => u.id)
    if (roomMemberIds.length > 0) {
      sendHubPush(roomMemberIds, {
        title: `#${roomData?.name ?? 'room'} — ${senderName}`,
        body: hasContent ? content.trim().slice(0, 120) : '📎 Sent an attachment',
        url: `/hub/${room_id}`,
      }, { roomId: room_id }).catch((err: Error) =>
        console.error('[messages] room push failed:', err.message)
      )
    }
  }

  // Check per-room and per-user Claude gates — both must pass
  const adminClient = createAdminClient()
  let roomClaudeEnabled = false
  let userClaudeAllowed = false
  {
    const [roomRow, senderRow] = await Promise.all([
      room_id
        ? adminClient.from('rooms').select('claude_enabled').eq('id', room_id).single()
        : Promise.resolve({ data: null }),
      adminClient.from('hub_users').select('claude_allowed').eq('id', user.id).single(),
    ])
    roomClaudeEnabled = (roomRow.data as { claude_enabled: boolean } | null)?.claude_enabled ?? false
    userClaudeAllowed = (senderRow.data as { claude_allowed: boolean } | null)?.claude_allowed ?? false
  }
  // For DMs: no room gate — only check the user gate
  const canUseClaude = userClaudeAllowed

  // @Guardian handler — rooms only, top-level and thread replies both supported
  if (room_id && roomClaudeEnabled && canUseClaude && hasContent && content.toLowerCase().includes('@guardian')) {
    handleClaudeReply({
      roomId: room_id,
      parentMessageId: parent_id ?? msg.id,
      threadId: parent_id ?? null,
      companyId: profile.company_id,
      triggeringContent: content.trim(),
      userId: user.id,
    }).catch(() => null)
  } else if (room_id && roomClaudeEnabled && canUseClaude && parent_id && hasContent) {
    // Thread reply without @guardian — auto-continue if Guardian is already in this thread
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parent_id)
      .eq('sender_id', CLAUDE_BOT_ID)
    if ((count ?? 0) > 0) {
      handleClaudeReply({
        roomId: room_id,
        parentMessageId: parent_id,
        threadId: parent_id,
        companyId: profile.company_id,
        triggeringContent: content.trim(),
        userId: user.id,
      }).catch(() => null)
    }
  }

  // @Guardian in DMs — user must be allowed; no room gate for DMs
  if (conversation_id && canUseClaude && hasContent && !parent_id) {
    const mentionsClaude = content.toLowerCase().includes('@guardian')
    if (mentionsClaude) {
      handleClaudeReplyDM({
        conversationId: conversation_id,
        companyId: profile.company_id,
        triggeringContent: content.trim(),
        userId: user.id,
      }).catch(() => null)
    } else {
      // Auto-continue: check if Claude has already posted in this DM
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversation_id)
        .eq('sender_id', CLAUDE_BOT_ID)
        .is('parent_id', null)
      if ((count ?? 0) > 0) {
        handleClaudeReplyDM({
          conversationId: conversation_id,
          companyId: profile.company_id,
          triggeringContent: content.trim(),
          userId: user.id,
        }).catch(() => null)
      }
    }
  }

  // Automation rules — only for top-level room messages from real users (not bot)
  if (room_id && !parent_id && hasContent && user.id !== CLAUDE_BOT_ID) {
    fireAutomationRules({
      companyId: profile.company_id,
      roomId: room_id,
      content: content.trim(),
      senderName,
      roomName: '', // resolved inside fireAutomationRules lazily
    }).catch(() => null)
  }

  // Chat Synx bridge — mirror Hub room messages (incl. thread replies) to Slack if a bridge exists
  if (room_id && (hasContent || hasFiles) && user.id !== CLAUDE_BOT_ID) {
    bridgeHubMessageToChatSynx({
      messageId: msg.id,
      roomId: room_id,
      parentId: parent_id ?? null,
      senderId: user.id,
      senderName,
      senderAvatarUrl: senderProfile?.avatar_url ?? null,
      content: hasContent ? content.trim() : '',
      files: hasFiles ? files : undefined,
    }).catch(() => null)
  }

  return NextResponse.json(msg, { status: 201 })
}

async function fireAutomationRules({
  companyId,
  roomId,
  content,
  senderName,
}: {
  companyId: string
  roomId: string
  content: string
  senderName: string
  roomName: string
}) {
  const admin = createAdminClient()

  const { data: rules } = await admin
    .from('hub_automation_rules')
    .select('id, trigger_room_id, keyword, action_type, target_room_id, target_user_id, target_board_id, message_template')
    .eq('company_id', companyId)
    .eq('active', true)

  if (!rules || rules.length === 0) return

  // Fetch room name once for template substitution
  const { data: roomRow } = await admin.from('rooms').select('name').eq('id', roomId).single()
  const roomName = roomRow?.name ?? ''

  const lowerContent = content.toLowerCase()

  for (const rule of rules) {
    // Room filter: null = watch any room
    if (rule.trigger_room_id && rule.trigger_room_id !== roomId) continue
    if (!lowerContent.includes(rule.keyword.toLowerCase())) continue

    const messageText = rule.message_template
      .replace(/\{trigger_message\}/g, content)
      .replace(/\{user\}/g, senderName)
      .replace(/\{room\}/g, roomName)

    if (rule.action_type === 'post_room' && rule.target_room_id) {
      await admin.from('messages').insert({
        company_id: companyId,
        room_id: rule.target_room_id,
        sender_id: CLAUDE_BOT_ID,
        content: messageText,
      })
    } else if (rule.action_type === 'create_board_task' && rule.target_board_id) {
      await admin.from('board_items').insert({
        board_id: rule.target_board_id,
        company_id: companyId,
        content: messageText,
        priority: 'none',
        created_by: CLAUDE_BOT_ID,
      })
    } else if (rule.action_type === 'dm_user' && rule.target_user_id) {
      // Find or create a DM conversation between the bot and the target user
      const { data: existing } = await admin
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', CLAUDE_BOT_ID)
        .limit(50)

      let conversationId: string | null = null

      if (existing && existing.length > 0) {
        const botConvIds = existing.map((m: { conversation_id: string }) => m.conversation_id)
        const { data: match } = await admin
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', rule.target_user_id)
          .in('conversation_id', botConvIds)
          .limit(1)
        if (match && match.length > 0) conversationId = match[0].conversation_id
      }

      if (!conversationId) {
        const { data: conv } = await admin
          .from('conversations')
          .insert({ company_id: companyId })
          .select('id')
          .single()
        if (!conv) continue
        conversationId = conv.id
        await admin.from('conversation_members').insert([
          { conversation_id: conversationId, user_id: CLAUDE_BOT_ID },
          { conversation_id: conversationId, user_id: rule.target_user_id },
        ])
      }

      await admin.from('messages').insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_id: CLAUDE_BOT_ID,
        content: messageText,
      })
    }
  }
}

async function handleClaudeReplyDM({
  conversationId,
  companyId,
  triggeringContent,
  userId,
}: {
  conversationId: string
  companyId: string
  triggeringContent: string
  userId: string
}) {
  const admin = createAdminClient()

  type MsgRow = { content: string; sender: { display_name: string } | { display_name: string }[] | null }

  const { data: recentMessages } = await admin
    .from('messages')
    .select('content, sender:hub_users!sender_id (display_name)')
    .eq('conversation_id', conversationId)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20)

  const history = ((recentMessages ?? []) as MsgRow[])
    .reverse()
    .map(m => {
      const sender = Array.isArray(m.sender) ? m.sender[0] : m.sender
      return `[${sender?.display_name ?? 'Unknown'}]: ${m.content}`
    })
    .join('\n')

  const { data: senderUser } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', userId)
    .single()
  const senderName = senderUser?.display_name ?? 'Someone'

  const systemPrompt = history
    ? `${CLAUDE_SYSTEM_PROMPT}\n\nConversation so far:\n${history}`
    : CLAUDE_SYSTEM_PROMPT

  // Instant acknowledgment so users know Claude is working
  await admin.from('messages').insert({
    company_id: companyId,
    conversation_id: conversationId,
    sender_id: CLAUDE_BOT_ID,
    content: 'On it! Please stand by…',
  })

  let claudeText = ''
  try {
    claudeText = await askClaude({
      systemPrompt,
      userMessage: `[${senderName}]: ${triggeringContent}`,
    })
  } catch {
    claudeText = "Sorry, I couldn't process that request right now."
  }

  if (!claudeText.trim()) return

  await admin.from('messages').insert({
    company_id: companyId,
    conversation_id: conversationId,
    sender_id: CLAUDE_BOT_ID,
    content: claudeText.trim(),
  })
}

async function handleClaudeReply({
  roomId,
  parentMessageId,
  threadId,
  companyId,
  triggeringContent,
  userId,
}: {
  roomId: string
  parentMessageId: string
  threadId: string | null
  companyId: string
  triggeringContent: string
  userId: string
}) {
  const admin = createAdminClient()

  type MsgRow = { content: string; sender: { display_name: string } | { display_name: string }[] | null }

  let history = ''

  if (threadId) {
    // In a thread — fetch all thread messages as context (the parent + all replies)
    const { data: parentMsg } = await admin
      .from('messages')
      .select('content, sender:hub_users!sender_id (display_name)')
      .eq('id', threadId)
      .single()

    const { data: threadMessages } = await admin
      .from('messages')
      .select('content, sender:hub_users!sender_id (display_name)')
      .eq('parent_id', threadId)
      .is('deleted_at', null)
      .neq('id', parentMessageId)
      .order('created_at', { ascending: true })

    const allThreadMsgs: MsgRow[] = []
    if (parentMsg) allThreadMsgs.push(parentMsg as MsgRow)
    if (threadMessages) allThreadMsgs.push(...(threadMessages as MsgRow[]))

    history = allThreadMsgs
      .map(m => {
        const sender = Array.isArray(m.sender) ? m.sender[0] : m.sender
        return `[${sender?.display_name ?? 'Unknown'}]: ${m.content}`
      })
      .join('\n')
  } else {
    // Top-level message — fetch last 20 room messages as context
    const { data: recentMessages } = await admin
      .from('messages')
      .select('content, sender:hub_users!sender_id (display_name)')
      .eq('room_id', roomId)
      .is('parent_id', null)
      .is('deleted_at', null)
      .neq('id', parentMessageId)
      .order('created_at', { ascending: false })
      .limit(20)

    history = ((recentMessages ?? []) as MsgRow[])
      .reverse()
      .map(m => {
        const sender = Array.isArray(m.sender) ? m.sender[0] : m.sender
        return `[${sender?.display_name ?? 'Unknown'}]: ${m.content}`
      })
      .join('\n')
  }

  const { data: senderUser } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', userId)
    .single()
  const senderName = senderUser?.display_name ?? 'Someone'

  const systemPrompt = history
    ? `${CLAUDE_SYSTEM_PROMPT}\n\nConversation so far:\n${history}`
    : CLAUDE_SYSTEM_PROMPT

  // Instant acknowledgment so users know Claude is working
  await admin.from('messages').insert({
    company_id: companyId,
    room_id: roomId,
    parent_id: parentMessageId,
    sender_id: CLAUDE_BOT_ID,
    content: 'On it! Please stand by…',
  })

  let claudeText = ''
  try {
    claudeText = await askClaude({
      systemPrompt,
      userMessage: `[${senderName}]: ${triggeringContent}`,
    })
  } catch {
    claudeText = "Sorry, I couldn't process that request right now."
  }

  if (!claudeText.trim()) return

  await admin.from('messages').insert({
    company_id: companyId,
    room_id: roomId,
    parent_id: parentMessageId,
    sender_id: CLAUDE_BOT_ID,
    content: claudeText.trim(),
  })
}
