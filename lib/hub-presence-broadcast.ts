import { createAdminClient } from '@/lib/supabase/admin'

// Fires a 'presence-changed' broadcast on hub-status-broadcast with the
// user's currently-computed effective_status from hub_users_with_presence.
// Used by:
//   - Hub layout (going-online on every Hub page-load)
//   - Timesheet punch route (clock in/out flips an hourly user's dot)
//
// Best-effort: any error is swallowed. Callers should not await this if they
// don't need the result — but channel subscribe+send is asynchronous and must
// complete before the request handler returns, otherwise Next's response
// teardown drops the connection. So callers that need delivery DO await.
export async function broadcastPresenceForUser(userId: string): Promise<void> {
  if (!userId) return
  try {
    const admin = createAdminClient()
    const { data: presence } = await admin
      .from('hub_users_with_presence')
      .select('effective_status')
      .eq('id', userId)
      .single()
    if (!presence?.effective_status) return

    const channel = admin.channel('hub-status-broadcast')
    await channel.subscribe()
    await channel.send({
      type: 'broadcast',
      event: 'presence-changed',
      payload: { user_id: userId, effective_status: presence.effective_status },
    })
    await admin.removeChannel(channel)
  } catch {
    // Non-fatal.
  }
}
