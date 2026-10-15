import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { broadcastPresenceForUser } from '@/lib/hub-presence-broadcast'
import { HUB_ACTIVE_WINDOW_MS } from '@/lib/hub-idle'

// POST /api/hub/active — "I'm still here." Called by HubActivityPinger on real
// interaction in Hub (throttled to once a minute) and every minute while on a
// call. Bumps hub_users.last_active_at, which drives the salaried/unlinked dot
// (green while within HUB_ACTIVE_WINDOW_MIN). If the person had already gone
// gray, broadcast so everyone else's sidebar flips them back to green now.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: me } = await admin.from('hub_users').select('last_active_at').eq('id', user.id).single()
  const { error } = await admin
    .from('hub_users')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const prev = me?.last_active_at
  if (!prev || Date.now() - new Date(prev).getTime() > HUB_ACTIVE_WINDOW_MS) {
    await broadcastPresenceForUser(user.id)
  }
  return NextResponse.json({ ok: true })
}
