import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGustoAuth } from '@/lib/gusto'

// Imports the full per-employee earnings breakdown from Gusto into
// payroll_periods, one row per (payroll run × employee).
//
// WHY THIS EXISTS: Crew & Labor used to price labour as clocked hours × the
// roster rate. That can see regular and overtime and nothing else — no
// commission, which for Heroes is a fifth of a fert tech's pay. Dollars now come
// from payroll, so the report spends real money instead of derived money. It also
// retires two approximations in one go: there is no rate history in the schema
// (every past week was priced at TODAY's rate), and hours × rate cannot blend a
// non-discretionary bonus into the FLSA regular rate, so every overtime week ran
// $10–30 light.
//
// ⚠ Gusto exposes earnings ONLY inside individual payroll records — the earnings
// summary endpoint carries no hours and list_time_records returns source:'none'.
// So this walks the payroll list and fetches each run. That is one request per
// week, which is why it is a manual/cron sync and not an on-request join.
//
// TWO DOORS, same work: an admin session (can_admin_integrations) for the button in
// Admin → Integrations, or the shared cron secret for a scheduled refresh:
//   curl -X POST https://lynxedo.com/api/admin/payroll/sync \
//     -H "x-cron-secret: $CRON_SECRET" -H 'content-type: application/json' \
//     -d '{"company_id":"…","start":"2025-12-22"}'
// The cron door needs an explicit company_id — there is no session to infer one
// from, and defaulting to a hardcoded tenant is how cross-tenant writes happen.
//
// ⚠ Idempotent by (company, source, external_id, employee_external_id) where
// external_id is the PAYROLL uuid. An off-cycle run that shares a pay period with
// the regular run therefore lands in its own row rather than overwriting it —
// Heroes has three such weeks (a Correction and two Tax reconciliations).

const GUSTO_API = 'https://api.gusto.com'

// Gusto's fixed_compensations[].name values, mapped to our columns. Anything not
// named here is summed into other_earnings rather than dropped, so a new earning
// type Ben adds in Gusto shows up as an unexplained total instead of silently
// vanishing from the report.
const FIXED_MAP: Record<string, 'commission' | 'bonus' | 'tips' | 'other_earnings'> = {
  'Commission': 'commission',
  'Bonus': 'bonus',
  'Paycheck Tips': 'tips',
  'Cash Tips': 'tips',
  'Correction Payment': 'other_earnings',
  'Severance': 'other_earnings',
  'Minimum Wage Adjustment': 'other_earnings',
}

type Row = {
  company_id: string
  source: 'gusto'
  external_id: string
  employee_external_id: string
  employee_id: string | null
  employee_name: string | null
  flsa_status: string | null
  period_start: string | null
  period_end: string | null
  check_date: string | null
  off_cycle: boolean
  regular_hours: number
  overtime_hours: number
  pto_hours: number
  regular_earnings: number
  overtime_earnings: number
  commission: number
  bonus: number
  holiday_earnings: number
  pto_earnings: number
  tips: number
  other_earnings: number
  gross_pay: number
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_integrations, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_integrations) return null
  return { companyId: profile?.company_id as string | null }
}

function n(v: unknown): number {
  const f = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return Number.isFinite(f) ? f : 0
}

async function gustoGet(path: string, token: string) {
  const res = await fetch(`${GUSTO_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Gusto ${path} → ${res.status} ${res.statusText}`)
  return res.json()
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const secret = req.headers.get('x-cron-secret')
  const viaCron = Boolean(secret && process.env.CRON_SECRET && secret === process.env.CRON_SECRET)

  let companyId: string | null = null
  if (viaCron) {
    // No session to derive a tenant from, so the caller must name one.
    companyId = typeof body.company_id === 'string' ? body.company_id : null
    if (!companyId) {
      return NextResponse.json(
        { error: 'company_id is required when calling with the cron secret' },
        { status: 400 }
      )
    }
  } else {
    const auth0 = await requireAdmin()
    companyId = auth0?.companyId ?? null
    if (!companyId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
  }

  const admin = createAdminClient()
  const auth = await getGustoAuth(admin, companyId)
  if (!auth) {
    return NextResponse.json({ error: 'Gusto is not connected' }, { status: 400 })
  }

  const start = typeof body.start === 'string' ? body.start : '2025-12-22'
  const end = typeof body.end === 'string' ? body.end : new Date().toISOString().slice(0, 10)

  // Roster, so payroll rows can be tied to our employees. Gusto uuid is the join.
  const { data: roster } = await admin
    .from('employees')
    .select('id, gusto_uuid')
    .eq('company_id', companyId)
  const byGusto = new Map((roster ?? []).map(e => [e.gusto_uuid, e.id]))

  let list: Array<Record<string, unknown>>
  try {
    list = await gustoGet(
      `/v1/companies/${auth.companyUuid}/payrolls`
      + `?processing_statuses=processed&payroll_types=regular,off_cycle`
      + `&start_date=${start}&end_date=${end}`,
      auth.token
    )
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }

  const rows: Row[] = []
  const skipped: string[] = []
  const unknownEarnings = new Set<string>()

  for (const p of list) {
    const uuid = String(p.payroll_uuid ?? p.uuid ?? '')
    if (!uuid) continue
    const period = (p.pay_period ?? {}) as { start_date?: string; end_date?: string }

    // ⚠ Tax reconciliation runs carry NO pay period. They are pure tax movement
    // with zero earnings, and a row with null dates could never be windowed, so
    // they are skipped by name rather than stored as an undateable row.
    if (!period.start_date || !period.end_date) {
      skipped.push(`${uuid} (${p.off_cycle_reason ?? 'no pay period'})`)
      continue
    }

    let full: Record<string, unknown>
    try {
      full = await gustoGet(`/v1/payrolls/${uuid}?include=payroll_status_meta`, auth.token)
    } catch (e) {
      skipped.push(`${uuid} (fetch failed: ${String(e)})`)
      continue
    }

    const comps = (full.employee_compensations ?? []) as Array<Record<string, unknown>>
    for (const c of comps) {
      if (c.excluded) continue
      const empUuid = String(c.employee_uuid ?? '')
      if (!empUuid) continue

      const acc = {
        regular_hours: 0, overtime_hours: 0, pto_hours: 0,
        regular_earnings: 0, overtime_earnings: 0, commission: 0, bonus: 0,
        holiday_earnings: 0, pto_earnings: 0, tips: 0, other_earnings: 0,
      }
      let flsa: string | null = null

      // Hourly lines: Regular Hours / Overtime / Double Overtime.
      for (const h of (c.hourly_compensations ?? []) as Array<Record<string, unknown>>) {
        const name = String(h.name ?? '')
        const hrs = n(h.hours)
        const amt = n(h.amount)
        if (!flsa && h.flsa_status) flsa = String(h.flsa_status)
        if (name === 'Regular Hours') {
          acc.regular_hours += hrs; acc.regular_earnings += amt
        } else if (name === 'Overtime' || name === 'Double Overtime') {
          acc.overtime_hours += hrs; acc.overtime_earnings += amt
        } else {
          // Unrecognised hourly line — money still counted, name surfaced.
          acc.other_earnings += amt
          if (amt) unknownEarnings.add(`hourly:${name}`)
        }
      }

      // Fixed lines: commission, bonus, tips, corrections. `Reimbursement`
      // deliberately ignored — it is expense repayment, not pay for work, and it
      // is already double-listed in reimbursements[].
      for (const f of (c.fixed_compensations ?? []) as Array<Record<string, unknown>>) {
        const name = String(f.name ?? '')
        const amt = n(f.amount)
        if (name === 'Reimbursement') continue
        const col = FIXED_MAP[name]
        if (col) acc[col] += amt
        else {
          acc.other_earnings += amt
          if (amt) unknownEarnings.add(`fixed:${name}`)
        }
      }

      // ⚠ HOLIDAY IS NOT IN THE CSV's PTO COLUMN. Gusto's report splits "Paid time
      // off earnings" (vacation + sick) from Holiday Hours, which appears ONLY
      // here. 8h × rate holiday pay therefore looks like an unnamed "tip" in the
      // export — the exact confusion that started this whole investigation. Kept
      // in its own column so it can never be mistaken for one again.
      for (const t of (c.paid_time_off ?? []) as Array<Record<string, unknown>>) {
        const name = String(t.name ?? '')
        const hrs = n(t.hours)
        const amt = n(t.amount)
        if (!hrs && !amt) continue
        if (name === 'Holiday Hours') {
          acc.holiday_earnings += amt
        } else {
          acc.pto_hours += hrs; acc.pto_earnings += amt
        }
      }

      rows.push({
        company_id: companyId,
        source: 'gusto',
        external_id: uuid,
        employee_external_id: empUuid,
        employee_id: byGusto.get(empUuid) ?? null,
        employee_name: [c.preferred_first_name || c.first_name, c.last_name]
          .filter(Boolean).join(' ') || null,
        flsa_status: flsa,
        period_start: period.start_date,
        period_end: period.end_date,
        check_date: typeof full.check_date === 'string' ? full.check_date : null,
        off_cycle: Boolean(p.off_cycle),
        ...acc,
        gross_pay: n(c.gross_pay),
      })
    }
  }

  if (!rows.length) {
    return NextResponse.json({ ok: true, imported: 0, skipped, note: 'No payrolls in range' })
  }

  const { error } = await admin
    .from('payroll_periods')
    .upsert(rows, { onConflict: 'company_id,source,external_id,employee_external_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    payrolls: list.length,
    imported: rows.length,
    unmatched_people: rows.filter(r => !r.employee_id).length,
    skipped,
    // Surfaced, never swallowed: an earning type Gusto has that we do not map.
    unmapped_earning_types: [...unknownEarnings],
    range: { start, end },
  })
}
