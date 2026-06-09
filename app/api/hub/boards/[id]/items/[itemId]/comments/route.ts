import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('board_item_comments')
    .select('id, content, created_at, created_by, creator:hub_users!created_by(id, display_name, avatar_url)')
    .eq('board_item_id', itemId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ comments: data ?? [] })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id: boardId, itemId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { content } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const trimmed = content.trim()

  const { data, error } = await supabase
    .from('board_item_comments')
    .insert({
      board_item_id: itemId,
      company_id: profile.company_id,
      content: trimmed,
      created_by: user.id,
    })
    .select('id, content, created_at, created_by, creator:hub_users!created_by(id, display_name, avatar_url)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify anyone @mentioned in the note. Mentions are plain `@FirstName`
  // tokens matched against hub_users' first name within the same company —
  // same convention as room/DM messages (app/api/hub/messages/route.ts).
  const mentionedFirstNames = [...trimmed.matchAll(/@(\w+)/g)].map((m: RegExpMatchArray) => m[1].toLowerCase())
  if (mentionedFirstNames.length > 0) {
    const admin = createAdminClient()
    const [{ data: senderRow }, { data: allUsers }, { data: boardRow }] = await Promise.all([
      admin.from('hub_users').select('display_name').eq('id', user.id).single(),
      admin.from('hub_users').select('id, display_name').eq('company_id', profile.company_id).not('id', 'eq', user.id),
      admin.from('boards').select('name, is_private, created_by').eq('id', boardId).single(),
    ])
    let recipientIds = (allUsers ?? [])
      .filter((u: { id: string; display_name: string }) =>
        mentionedFirstNames.some(n => u.display_name.split(' ')[0].toLowerCase() === n),
      )
      .map((u: { id: string }) => u.id)

    // A private board is only visible to its creator + board_members — never
    // notify someone who can't open the board (mirrors boards_select RLS).
    if (boardRow?.is_private) {
      const { data: members } = await admin
        .from('board_members')
        .select('user_id')
        .eq('board_id', boardId)
      const allowed = new Set<string>([
        boardRow.created_by,
        ...((members ?? []) as { user_id: string }[]).map(m => m.user_id),
      ])
      recipientIds = recipientIds.filter((id: string) => allowed.has(id))
    }

    if (recipientIds.length > 0) {
      const senderName = senderRow?.display_name ?? 'Someone'
      const boardName = boardRow?.name ?? 'a board'
      sendHubPush(recipientIds, {
        title: `${senderName} mentioned you on ${boardName}`,
        body: trimmed.slice(0, 120),
        url: `/hub/board/${boardId}`,
      }, { isMention: true }).catch((err: Error) =>
        console.error('[board comments] mention push failed:', err.message),
      )
    }
  }

  return NextResponse.json(data, { status: 201 })
}
