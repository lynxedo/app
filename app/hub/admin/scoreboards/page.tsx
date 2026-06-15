import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SCOREBOARDS } from '@/lib/scoreboards/registry'
import ScoreboardTechniciansPanel from './ScoreboardTechniciansPanel'
import ScoreboardBoardAccessPanel from './ScoreboardBoardAccessPanel'

export const metadata = { title: 'Scoreboards Admin' }

// Boards whose per-technician panel (revenue + $/hour) is driven by explicit
// assignment via scoreboard_technicians. WF/IR/PW each have one; Main and Office
// aren't built around per-technician numbers, so they're not listed here.
const BOARDS = [
  { slug: '2', title: 'WF Weed & Fert' },
  { slug: '3', title: 'IR Irrigation' },
  { slug: '4', title: 'PW Pet Waste' },
]

export default async function ScoreboardsAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  // Scoreboard tech assignment is a full-admin function (no per-area grant).
  if (profile?.role !== 'admin' || !profile.company_id) redirect('/hub/home')
  const company = profile.company_id

  const admin = createAdminClient()
  const [{ data: emps }, { data: assigns }, { data: scoreUsers }, { data: hubUsers }, { data: boardAccess }] = await Promise.all([
    admin
      .from('employees')
      .select('id, first_name, last_name, preferred_name, job_title, department')
      .eq('company_id', company)
      .eq('is_active', true)
      .order('last_name'),
    admin
      .from('scoreboard_technicians')
      .select('board_slug, employee_id')
      .eq('company_id', company),
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

  const employees = (emps ?? []).map(e => ({
    id: e.id,
    name: `${(e.preferred_name?.trim() || e.first_name)} ${e.last_name}`,
    job_title: e.job_title,
    department: e.department,
  }))
  const assignments: Record<string, string[]> = {}
  for (const a of (assigns ?? [])) (assignments[a.board_slug] ??= []).push(a.employee_id)

  const nameById = new Map((hubUsers ?? []).map(u => [u.id, u.display_name]))
  const accessUsers = (scoreUsers ?? [])
    .filter(u => u.role !== 'admin')
    .map(u => ({ id: u.id, name: (nameById.get(u.id)?.trim() || u.full_name?.trim() || 'Unnamed user') }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const access: Record<string, string[]> = {}
  for (const r of (boardAccess ?? [])) (access[r.user_id] ??= []).push(r.board_slug)

  const accessBoards = SCOREBOARDS.map(b => ({ slug: b.slug, title: b.title, badge: b.badge }))

  return (
    <div className="space-y-10">
      <ScoreboardBoardAccessPanel boards={accessBoards} users={accessUsers} initialAccess={access} />
      <ScoreboardTechniciansPanel boards={BOARDS} employees={employees} initialAssignments={assignments} />
    </div>
  )
}
