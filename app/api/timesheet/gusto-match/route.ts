import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getGustoAuth,
  hasGustoConnection,
  fetchGustoEmployees,
  deriveGustoComp,
  type GustoEmployee,
} from '@/lib/gusto'

// Match with Gusto: the roster is the source of membership (people get on it
// via the Employee Roster toggle in Admin → People, never from Gusto). This
// route only MATCHES existing roster rows to Gusto people and proposes field
// updates (title / dept / pay type / rate) that the admin approves per-field.
// Nothing is ever added or deactivated here — unmatched people on either side
// are reported as FYIs.

type MatchDiff = {
  field: 'job_title' | 'department' | 'pay_type' | 'hourly_rate'
  label: string
  current: string
  incoming: string
}

const FIELD_WHITELIST = new Set(['job_title', 'department', 'pay_type', 'hourly_rate'])

async function requireTimesheetAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return null
  return { user, companyId: profile?.company_id as string | null }
}

function fmtRate(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}/hr`
}

type DbEmployee = {
  id: string
  gusto_uuid: string | null
  first_name: string
  last_name: string
  preferred_name: string | null
  email: string | null
  department: string | null
  job_title: string | null
  pay_type: 'hourly' | 'salary'
  hourly_rate: string | number | null
}

function matchGustoEmployee(emp: DbEmployee, gustoEmployees: GustoEmployee[], claimed: Set<string>) {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  let matchedBy: 'gusto' | 'email' | 'name' | null = null
  let ge: GustoEmployee | undefined

  if (emp.gusto_uuid) {
    ge = gustoEmployees.find(g => g.uuid === emp.gusto_uuid && !claimed.has(g.uuid))
    if (ge) matchedBy = 'gusto'
  }
  if (!ge && emp.email) {
    ge = gustoEmployees.find(g => norm(g.email) === norm(emp.email) && !claimed.has(g.uuid))
    if (ge) matchedBy = 'email'
  }
  if (!ge) {
    const names = [
      `${norm(emp.first_name)} ${norm(emp.last_name)}`,
      emp.preferred_name ? `${norm(emp.preferred_name)} ${norm(emp.last_name)}` : null,
    ].filter(Boolean)
    ge = gustoEmployees.find(g => {
      if (claimed.has(g.uuid)) return false
      const gNames = [
        `${norm(g.first_name)} ${norm(g.last_name)}`,
        g.preferred_first_name ? `${norm(g.preferred_first_name)} ${norm(g.last_name)}` : null,
      ].filter(Boolean)
      return gNames.some(n => names.includes(n as string))
    })
    if (ge) matchedBy = 'name'
  }
  if (ge) claimed.add(ge.uuid)
  return { ge, matchedBy }
}

function buildDiffs(emp: DbEmployee, ge: GustoEmployee): MatchDiff[] {
  const { payType, rate, title } = deriveGustoComp(ge)
  const diffs: MatchDiff[] = []

  if (title && title !== emp.job_title) {
    diffs.push({ field: 'job_title', label: 'Title', current: emp.job_title ?? '—', incoming: title })
  }
  const dept = ge.department ?? null
  if (dept && dept !== emp.department) {
    diffs.push({ field: 'department', label: 'Department', current: emp.department ?? '—', incoming: dept })
  }
  if (payType !== emp.pay_type) {
    diffs.push({ field: 'pay_type', label: 'Pay type', current: emp.pay_type, incoming: payType })
  }
  if (payType === 'hourly' && rate !== null) {
    const current = emp.hourly_rate === null ? null : parseFloat(String(emp.hourly_rate))
    if (current === null || Math.abs(current - rate) > 0.001) {
      diffs.push({ field: 'hourly_rate', label: 'Rate', current: fmtRate(current), incoming: fmtRate(rate) })
    }
  }
  return diffs
}

// GET — match preview (?status=1 for a cheap connected check)
export async function GET(req: NextRequest) {
  const auth = await requireTimesheetAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!auth.companyId) return NextResponse.json({ error: 'No company' }, { status: 400 })

  const admin = createAdminClient()

  if (req.nextUrl.searchParams.get('status') === '1') {
    return NextResponse.json({ connected: await hasGustoConnection(admin, auth.companyId) })
  }

  const gustoAuth = await getGustoAuth(admin, auth.companyId)
  if (!gustoAuth) return NextResponse.json({ connected: false })

  let gustoEmployees: GustoEmployee[]
  try {
    gustoEmployees = await fetchGustoEmployees(gustoAuth)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gusto API error' }, { status: 502 })
  }

  const { data: dbEmployees } = await admin
    .from('employees')
    .select('id, gusto_uuid, first_name, last_name, preferred_name, email, department, job_title, pay_type, hourly_rate')
    .eq('is_active', true)
    .order('first_name')

  const claimed = new Set<string>()
  const matches: Record<string, unknown>[] = []
  const unmatchedRoster: Record<string, unknown>[] = []

  for (const emp of (dbEmployees ?? []) as DbEmployee[]) {
    const name = `${emp.first_name} ${emp.last_name}`
    const { ge, matchedBy } = matchGustoEmployee(emp, gustoEmployees, claimed)
    if (!ge) {
      unmatchedRoster.push({ id: emp.id, name })
      continue
    }
    const diffs = buildDiffs(emp, ge)
    matches.push({
      employee_id: emp.id,
      name,
      gusto_uuid: ge.uuid,
      matched_by: matchedBy,
      diffs,
      up_to_date: diffs.length === 0,
    })
  }

  const unmatchedGusto = gustoEmployees
    .filter(g => !claimed.has(g.uuid))
    .map(g => ({
      name: `${g.first_name} ${g.last_name}`,
      title: g.jobs?.[0]?.title ?? null,
    }))

  return NextResponse.json({
    connected: true,
    matches,
    unmatched_roster: unmatchedRoster,
    unmatched_gusto: unmatchedGusto,
  })
}

// POST — apply approved field changes. Values are NEVER trusted from the
// request body: the client only says WHICH employee + WHICH fields; the actual
// values are re-fetched live from Gusto and re-derived server-side.
export async function POST(req: NextRequest) {
  const auth = await requireTimesheetAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!auth.companyId) return NextResponse.json({ error: 'No company' }, { status: 400 })

  const { changes } = await req.json()
  if (!Array.isArray(changes)) return NextResponse.json({ error: 'changes array required' }, { status: 400 })

  const admin = createAdminClient()
  const gustoAuth = await getGustoAuth(admin, auth.companyId)
  if (!gustoAuth) return NextResponse.json({ error: 'Gusto is not connected' }, { status: 400 })

  let gustoEmployees: GustoEmployee[]
  try {
    gustoEmployees = await fetchGustoEmployees(gustoAuth)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gusto API error' }, { status: 502 })
  }
  const byUuid = new Map(gustoEmployees.map(g => [g.uuid, g]))

  const results = { updated: 0, errors: [] as string[] }

  for (const change of changes) {
    const label = typeof change.name === 'string' ? change.name : change.employee_id
    try {
      const ge = byUuid.get(change.gusto_uuid)
      if (!ge) {
        results.errors.push(`${label}: not found in Gusto — skipped`)
        continue
      }
      const fields: string[] = Array.isArray(change.fields)
        ? change.fields.filter((f: string) => FIELD_WHITELIST.has(f))
        : []
      if (fields.length === 0) continue

      const { payType, rate, flsa, title } = deriveGustoComp(ge)
      const update: Record<string, unknown> = {
        gusto_uuid: ge.uuid,
        gusto_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      if (fields.includes('job_title') && title) update.job_title = title
      if (fields.includes('department') && ge.department) update.department = ge.department
      if (fields.includes('pay_type')) {
        update.pay_type = payType
        update.flsa_status = flsa
        update.hourly_rate = rate
      }
      if (fields.includes('hourly_rate') && payType === 'hourly' && rate !== null) {
        update.hourly_rate = rate
      }

      const { error } = await admin.from('employees').update(update).eq('id', change.employee_id)
      if (error) {
        results.errors.push(`${label}: ${error.message}`)
        continue
      }
      results.updated++
    } catch (e) {
      results.errors.push(`${label}: ${e}`)
    }
  }

  return NextResponse.json({ ok: true, results })
}
