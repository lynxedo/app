import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { feedDebugEnabled } from '@/lib/feed-debug'

// ⚠ TEMPORARY — Oct 23 2026. POST /api/hub/feed-debug — one diagnostic event
// from MessageFeed (see lib/feed-debug.ts), written to the server log as a
// single `[feed-debug]` line. Only the users in lib/feed-debug.ts are logged.
// Nothing is stored in the database. Remove with lib/feed-debug.ts.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!feedDebugEnabled(user.id)) return new NextResponse(null, { status: 204 })

  const raw = (await request.text()).slice(0, 4000)
  const ua = (request.headers.get('user-agent') || '').slice(0, 60)
  console.log(`[feed-debug] user=${user.id.slice(0, 8)} ua=${JSON.stringify(ua)} ${raw}`)
  return new NextResponse(null, { status: 204 })
}
