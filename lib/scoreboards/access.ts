import type { createClient } from '@/lib/supabase/server'

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * The board slugs a user is explicitly granted (Admin -> Scoreboards). Drives the
 * per-board view gate. RLS lets a user read only their own rows, so this is safe
 * with the request-scoped (user) Supabase client. Admins bypass this entirely —
 * see `boardsForUser` / `canSeeBoard` in ./registry.
 */
export async function getGrantedBoardSlugs(
  supabase: ServerClient,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('scoreboard_board_access')
    .select('board_slug')
    .eq('user_id', userId)
  return (data ?? []).map(r => r.board_slug as string)
}
