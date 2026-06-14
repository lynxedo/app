import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeDayEntry } from '@/lib/timesheet-recompute'
import { centralDate } from '@/lib/timezone'
import { fanoutGuardianNotification } from '@/lib/guardian-post'

export const dynamic = 'force-dynamic'

// TS5 — nightly auto-clock-out safety net. A forgotten clock-out would otherwise
// leave someone "clocked in" indefinitely (and no payroll entry ever computes for
// that day, since recompute needs a complete pair). Any open shift longer than the
// cap is treated as a forgotten punch: we insert an 'out' capped at clock-in + cap,
// note it for review, recompute the day, and notify the employee + timesheet admins.
//
// Note-based (no schema change): the auto-close is a normal 'out' punch with a clear
// note, so it shows in the day editor and an admin can correct the real end time
// (which recomputes the entry).
const MAX_SHIFT_HOURS = 14

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) return true
    if (req.headers.get('Authorization') === `Bearer ${cronSecret}`) return true
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin'
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const capMs = MAX_SHIFT_HOURS * 3600000
  const cutoffIso = new Date(Date.now() - capMs).toISOString()

  // Candidates: any 'in' punch older than the cap. We re-verify each is still the
  // employee's latest punch (i.e. they never clocked out) before closing it.
  const { data: oldIns } = await admin
    .from('time_punches')
    .select('employee_id')
    .eq('punch_type', 'in')
    .lt('punched_at', cutoffIso)

  const employeeIds = [...new Set((oldIns ?? []).map((p: { employee_id: string }) => p.employee_id))]
  const closed: { employeeId: string; day: string; outIso: string }[] = []

  for (const employeeId of employeeIds) {
    const { data: latest } = await admin
      .from('time_punches')
      .select('id, punch_type, punched_at')
      .eq('employee_id', employeeId)
      .order('punched_at', { ascending: false })
      .limit(1)
      .single()

    // Only act if their CURRENT state is "clocked in" and it's older than the cap.
    if (!latest || latest.punch_type !== 'in') continue
    const inTime = new Date(latest.punched_at)
    if (Date.now() - inTime.getTime() <= capMs) continue

    const outIso = new Date(inTime.getTime() + capMs).toISOString()
    const { error: insErr } = await admin.from('time_punches').insert({
      employee_id: employeeId,
      punch_type: 'out',
      punched_at: outIso,
      note: `Auto clock-out after ${MAX_SHIFT_HOURS}h — please verify`,
    })
    if (insErr) {
      console.error('[timesheet:auto-clock-out] failed to insert out punch', { employeeId, insErr })
      continue
    }

    const day = centralDate(inTime)
    await recomputeDayEntry(admin, employeeId, day)
    closed.push({ employeeId, day, outIso })
  }

  // Notify: each affected employee, plus a per-company summary to timesheet admins.
  // Best-effort — never fail the job over a notification.
  if (closed.length) {
    try {
      await notifyAutoClosures(admin, closed)
    } catch (e) {
      console.error('[timesheet:auto-clock-out] notification failed', e)
    }
  }

  return NextResponse.json({ ok: true, closed: closed.length, days: closed })
}

type AdminClient = ReturnType<typeof createAdminClient>

async function notifyAutoClosures(
  admin: AdminClient,
  closed: { employeeId: string; day: string; outIso: string }[],
) {
  // Map employee -> user_id + company_id + display name.
  const employeeIds = closed.map(c => c.employeeId)
  const { data: emps } = await admin
    .from('employees').select('id, user_id').in('id', employeeIds)
  const empUser = new Map<string, string>()
  for (const e of (emps ?? []) as { id: string; user_id: string | null }[]) {
    if (e.user_id) empUser.set(e.id, e.user_id)
  }

  const userIds = [...empUser.values()]
  const { data: profs } = userIds.length
    ? await admin.from('user_profiles').select('id, company_id').in('id', userIds)
    : { data: [] as { id: string; company_id: string }[] }
  const userCompany = new Map<string, string>()
  for (const p of (profs ?? []) as { id: string; company_id: string }[]) {
    userCompany.set(p.id, p.company_id)
  }
  const { data: hus } = userIds.length
    ? await admin.from('hub_users').select('id, display_name').in('id', userIds)
    : { data: [] as { id: string; display_name: string }[] }
  const userName = new Map<string, string>()
  for (const h of (hus ?? []) as { id: string; display_name: string }[]) {
    userName.set(h.id, h.display_name)
  }

  // DM each affected employee.
  for (const c of closed) {
    const uid = empUser.get(c.employeeId)
    const companyId = uid ? userCompany.get(uid) : undefined
    if (!uid || !companyId) continue
    await fanoutGuardianNotification({
      companyId,
      userIds: [uid],
      roomIds: [],
      body: `⏰ You were still clocked in after ${MAX_SHIFT_HOURS}h, so you were auto-clocked-out on ${c.day}. Please check your timesheet and fix the time if it's wrong.`,
      admin,
    })
  }

  // Per-company summary to the timesheet admins.
  const byCompany = new Map<string, { name: string; day: string }[]>()
  for (const c of closed) {
    const uid = empUser.get(c.employeeId)
    const companyId = uid ? userCompany.get(uid) : undefined
    if (!companyId) continue
    const list = byCompany.get(companyId) ?? []
    list.push({ name: (uid && userName.get(uid)) || 'an employee', day: c.day })
    byCompany.set(companyId, list)
  }

  for (const [companyId, list] of byCompany) {
    const { data: admins } = await admin
      .from('user_profiles')
      .select('id')
      .eq('company_id', companyId)
      .or('role.eq.admin,can_admin_timesheet.eq.true')
    const adminIds = (admins ?? []).map((a: { id: string }) => a.id)
    if (!adminIds.length) continue
    const lines = list.map(l => `• ${l.name} (${l.day})`).join('\n')
    await fanoutGuardianNotification({
      companyId,
      userIds: adminIds,
      roomIds: [],
      body: `⏰ Auto clock-out ran. These shifts were open past ${MAX_SHIFT_HOURS}h and were capped — please verify:\n${lines}`,
      admin,
    })
  }
}
