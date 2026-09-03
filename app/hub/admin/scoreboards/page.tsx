import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SCOREBOARDS } from '@/lib/scoreboards/registry'
import ScoreboardBoardAccessPanel from './ScoreboardBoardAccessPanel'

export const metadata = { title: 'Scoreboards Admin' }

/* Who can see each shipped board.
 *
 * The per-board TECHNICIAN panel used to live here too — an explicit roster per
 * board, feeding the revenue and $/hour columns on WF, IR and PW. All three boards
 * retired on Sep 3 2026 and nothing else ever read `scoreboard_technicians`, so the
 * panel and its route went with them. The per-person cards in the widget library
 * resolve people through the People roster instead (lib/scoreboards/person-map.ts),
 * which is one roster rather than one per board.
 *
 * ⚠ The table's 17 rows were left in place, not dropped — see the session notes. A
 * re-shipped per-board roster would want them, and they cost nothing.
 */
export default async function ScoreboardsAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  // Granting board access is a full-admin function (no per-area grant).
  if (profile?.role !== 'admin' || !profile.company_id) redirect('/hub/home')
  const company = profile.company_id

  const admin = createAdminClient()
  const [{ data: scoreUsers }, { data: hubUsers }, { data: boardAccess }] = await Promise.all([
    // Users who have the section flag (Admin -> People). Only they can see any
    // board, so they're the candidates for per-board access. Admins always see
    // all boards and are excluded from the matrix.
    admin
      .from('user_profiles')
      .select('id, full_name, role, can_access_scoreboards')
      .eq('company_id', company)
      .eq('can_access_scoreboards', true),
    admin
      .from('hub_users')
      .select('id, display_name'),
    admin
      .from('scoreboard_board_access')
      .select('user_id, board_slug')
      .eq('company_id', company),
  ])

  const nameById = new Map((hubUsers ?? []).map(u => [u.id, u.display_name]))
  const accessUsers = (scoreUsers ?? [])
    .filter(u => u.role !== 'admin')
    .map(u => ({ id: u.id, name: (nameById.get(u.id)?.trim() || u.full_name?.trim() || 'Unnamed user') }))
    .sort((a, b) => a.name.localeCompare(b.name))

  /* Grants for boards that no longer exist are simply not rendered — the rows stay
   * in scoreboard_board_access, harmless, because `canSeeBoard` tests membership
   * against a slug the registry must also know. */
  const access: Record<string, string[]> = {}
  for (const r of (boardAccess ?? [])) (access[r.user_id] ??= []).push(r.board_slug)

  const accessBoards = SCOREBOARDS.map(b => ({ slug: b.slug, title: b.title, badge: b.badge }))

  return (
    <div className="space-y-10">
      <ScoreboardBoardAccessPanel boards={accessBoards} users={accessUsers} initialAccess={access} />
    </div>
  )
}
