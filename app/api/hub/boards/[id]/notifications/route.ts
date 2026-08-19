import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  BOARD_NOTIFY_DEFAULTS,
  sanitizeBoardNotifyPrefs,
  type BoardNotifyPrefs,
} from '@/lib/board-notify'

// The signed-in person's own notification settings for one board. There is no
// way to read or write anyone else's — RLS on board_notification_prefs is
// own-row, and both handlers filter on the caller's id as well.

type SB = Awaited<ReturnType<typeof createClient>>

/** The board must exist, be in the caller's company, and be one they can open. */
async function boardNotVisible(supabase: SB, boardId: string, userId: string) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', userId)
    .maybeSingle()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Read through the CALLER's client, so boards_select decides visibility —
  // a private board they don't belong to simply isn't there.
  const { data: board } = await supabase
    .from('boards')
    .select('id, company_id')
    .eq('id', boardId)
    .maybeSingle()
  if (!board || board.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: boardId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await boardNotVisible(supabase, boardId, user.id)
  if (denied) return denied

  const { data } = await supabase
    .from('board_notification_prefs')
    .select('new_tasks, replies, files, due')
    .eq('board_id', boardId)
    .eq('user_id', user.id)
    .maybeSingle()

  // No row saved yet → hand back the defaults, so the panel opens showing what
  // is actually happening today rather than a blank slate.
  const prefs: BoardNotifyPrefs = data ? sanitizeBoardNotifyPrefs(data) : { ...BOARD_NOTIFY_DEFAULTS }
  return NextResponse.json({ prefs, customized: !!data })
}

// PUT body: { new_tasks?, replies?, files?, due? } — each 'all' | 'mine' | 'off'.
// Anything missing or unrecognised falls back to its default rather than
// failing the save, so a partial update can never write a nonsense level.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: boardId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await boardNotVisible(supabase, boardId, user.id)
  if (denied) return denied

  const body = await request.json().catch(() => ({}))
  const prefs = sanitizeBoardNotifyPrefs(body)

  const { error } = await supabase
    .from('board_notification_prefs')
    .upsert(
      { board_id: boardId, user_id: user.id, ...prefs, updated_at: new Date().toISOString() },
      { onConflict: 'board_id,user_id' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ prefs, customized: true })
}
