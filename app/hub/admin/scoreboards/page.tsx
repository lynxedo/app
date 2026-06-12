import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ScoreboardTechniciansPanel from './ScoreboardTechniciansPanel'

export const metadata = { title: 'Scoreboards Admin' }

// Boards that have a per-technician panel driven by explicit assignment.
// (WF board 2 still auto-discovers by job title today; it can be migrated to
// this same table later by adding it here + switching buildWfBoard.)
const BOARDS = [{ slug: '3', title: 'IR Irrigation' }]

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
  const [{ data: emps }, { data: assigns }] = await Promise.all([
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
  ])

  const employees = (emps ?? []).map(e => ({
    id: e.id,
    name: `${(e.preferred_name?.trim() || e.first_name)} ${e.last_name}`,
    job_title: e.job_title,
    department: e.department,
  }))
  const assignments: Record<string, string[]> = {}
  for (const a of (assigns ?? [])) (assignments[a.board_slug] ??= []).push(a.employee_id)

  return <ScoreboardTechniciansPanel boards={BOARDS} employees={employees} initialAssignments={assignments} />
}
