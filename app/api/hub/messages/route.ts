import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { askClaude } from '@/lib/hub-claude'

const MESSAGE_SELECT = `
  id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from,
  sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
  reactions (message_id, user_id, emoji),
  files (id, filename, mime_type, size_bytes, storage_path)
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

  // Fetch original messages for any forwarded messages
  const forwardedIds = (data ?? []).map((m: { forwarded_from: string | null }) => m.forwarded_from).filter(Boolean) as string[]
  let forwardedMap: Record<string, { id: string; content: string; sender: { display_name: string } | null; room_id: string | null; conversation_id: string | null }> = {}
  if (forwardedIds.length > 0) {
    const { data: originals } = await supabase
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

  if (hasFiles) {
    await supabase.from('files').insert(
      files.map((f: { storage_path: string; filename: string; mime_type: string; size_bytes: number }) => ({
        company_id: profile.company_id,
        message_id: msg.id,
        uploader_id: user.id,
        storage_path: f.storage_path,
        filename: f.filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
      }))
    )
  }

  // Push for @mentions — pass room_id so push logic can check mute prefs
  const textToScan = content ?? ''
  const mentionedFirstNames = [...textToScan.matchAll(/@(\w+)/g)].map((m: RegExpMatchArray) => m[1].toLowerCase())
  if (mentionedFirstNames.length > 0) {
    const { data: senderProfile } = await supabase
      .from('hub_users')
      .select('display_name')
      .eq('id', user.id)
      .single()

    const { data: allUsers } = await supabase
      .from('hub_users')
      .select('id, display_name')
      .not('id', 'eq', user.id)

    const matchedIds = (allUsers ?? [])
      .filter((u: { id: string; display_name: string }) =>
        mentionedFirstNames.some(n => u.display_name.split(' ')[0].toLowerCase() === n)
      )
      .map((u: { id: string }) => u.id)

    if (matchedIds.length > 0) {
      const senderName = senderProfile?.display_name ?? 'Someone'
      const destination = room_id ? `/hub/${room_id}` : `/hub/pm/${conversation_id}`
      await sendHubPush(matchedIds, {
        title: `${senderName} mentioned you`,
        body: textToScan.trim().slice(0, 120),
        url: destination,
      }, { isMention: true, roomId: room_id ?? null })
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

  // @Claude handler — rooms only, top-level and thread replies both supported
  if (room_id && roomClaudeEnabled && canUseClaude && hasContent && content.toLowerCase().includes('@claude')) {
    handleClaudeReply({
      roomId: room_id,
      parentMessageId: parent_id ?? msg.id,
      threadId: parent_id ?? null,
      companyId: profile.company_id,
      triggeringContent: content.trim(),
      userId: user.id,
    }).catch(() => null)
  } else if (room_id && roomClaudeEnabled && canUseClaude && parent_id && hasContent) {
    // Thread reply without @claude — auto-continue if Claude is already in this thread
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

  // @Claude in DMs — user must be allowed; no room gate for DMs
  if (conversation_id && canUseClaude && hasContent && !parent_id) {
    const mentionsClaude = content.toLowerCase().includes('@claude')
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

  return NextResponse.json(msg, { status: 201 })
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
