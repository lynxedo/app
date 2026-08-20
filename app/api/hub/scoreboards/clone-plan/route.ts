import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { planCustomBoardClone, resolveScoreboardCaller } from '@/lib/scoreboards/custom'
import { personKey } from '@/lib/scoreboards/widgets/people-filter'
import type { LeadItemsRow } from '@/lib/scoreboards/widgets/sources'

export const dynamic = 'force-dynamic'

/* What duplicating a scoreboard would do, and where the answers get recorded.
 *
 * GET  ?from=<slug>[&for=<employeeId>]
 *      → { source, roster, repoint }   see `ClonePlan`
 * POST { employeeId, kind, value }
 *      → { ok: true }                  remember which name a person goes by
 *
 * ⚠⚠ WHY A POST EXISTS AT ALL. Three of the five ways a person is named across the
 * widget library can be tied to the roster with certainty; two cannot, because
 * Jobber user names and the Lead Tracker's typed salesperson column have no link to
 * an employee row (see lib/scoreboards/person-map.ts). Rather than guess by first
 * name — which is how two colleagues who share one get merged into a single number
 * — the dialog asks once and posts the answer here. Every later clone for that
 * person is then automatic.
 *
 * Gate: the same one as creating a board. The GET reads only a board the caller
 * already owns plus their own roster; the POST writes a name-to-person mapping,
 * which is bookkeeping about their own staff. The name LISTS the dialog offers come
 * from /api/hub/scoreboards/catalogs, which keeps its own per-report gate — this
 * route deliberately doesn't re-implement it.
 */

const ALL_TIME_START = '1900-01-01'
const ALL_TIME_END = '2999-12-31'

/** The two catalogs with no roster link, and so the only two worth recording. */
const RECORDABLE = new Set(['jobber_people', 'lead_salespeople'])

export async function GET(request: Request) {
  const resolved = await resolveScoreboardCaller()
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { caller } = resolved

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  if (!from) return NextResponse.json({ error: 'Missing board' }, { status: 400 })

  const plan = await planCustomBoardClone(
    caller.companyId, caller.userId, caller.isAdmin, from, url.searchParams.get('for'),
  )
  if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: plan.status })

  const res = NextResponse.json(plan)
  // The plan describes the board as it is saved RIGHT NOW; a cached one would
  // describe it as it was before the edit somebody just made.
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/**
 * Record which name a person goes by in a system that doesn't carry roster ids.
 *
 * ⚠ The value is checked against the REAL list before it is stored. A recorded name
 * that matches nothing renders a plausible zero on every future board rather than an
 * error, and it would be blamed on the figures rather than on this row.
 */
export async function POST(request: Request) {
  const resolved = await resolveScoreboardCaller()
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { caller } = resolved

  const body = await request.json().catch(() => ({})) as {
    employeeId?: unknown; kind?: unknown; value?: unknown
  }
  const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : ''
  const kind = typeof body.kind === 'string' ? body.kind : ''
  const value = typeof body.value === 'string' ? body.value.trim() : ''

  if (!employeeId || !RECORDABLE.has(kind) || !value) {
    return NextResponse.json({ error: 'Need a person, a system and a name' }, { status: 400 })
  }

  const admin = createAdminClient()

  // The person must be on THIS company's roster — an id from anywhere else would
  // otherwise be accepted by the foreign key and stored against another tenant.
  const { data: emp } = await admin
    .from('employees')
    .select('id')
    .eq('company_id', caller.companyId)
    .eq('id', employeeId)
    .maybeSingle()
  if (!emp) return NextResponse.json({ error: 'No such person on the roster' }, { status: 404 })

  const known = await knownValues(caller.companyId, kind)
  if (!known.has(personKey(value))) {
    return NextResponse.json(
      { error: `“${value}” isn’t a name that appears in ${kind === 'jobber_people' ? 'Jobber' : 'the Lead Tracker'}` },
      { status: 400 },
    )
  }

  const { error } = await admin
    .from('employee_source_aliases')
    .upsert(
      {
        company_id: caller.companyId,
        employee_id: employeeId,
        kind,
        value,
        updated_at: new Date().toISOString(),
        created_by: caller.userId,
      },
      // Answering again replaces this person's answer for this system.
      { onConflict: 'company_id,employee_id,kind' },
    )

  if (error) {
    // ⚠ The OTHER unique index — one owner per name — is a real answer, not a
    // failure: somebody already claimed this name, and quietly overwriting them is
    // the silent merge the whole design exists to prevent.
    const taken = /employee_source_aliases_value_kind_uniq/.test(error.message)
    return NextResponse.json(
      { error: taken ? `“${value}” is already recorded as somebody else` : error.message },
      { status: taken ? 409 : 500 },
    )
  }

  return NextResponse.json({ ok: true })
}

/** The names that actually exist in the system being recorded against. */
async function knownValues(companyId: string, kind: string): Promise<Set<string>> {
  const admin = createAdminClient()
  const out = new Set<string>()

  if (kind === 'jobber_people') {
    const { data } = await admin
      .from('jobber_users')
      .select('name')
      .eq('company_id', companyId)
      .not('name', 'is', null)
    for (const u of data ?? []) if (u.name) out.add(personKey(String(u.name)))
    return out
  }

  // Same call the picker is built from, so the two can't offer different names.
  const { data } = await admin.rpc('scoreboard_lead_items', {
    p_company_id: companyId,
    p_start: ALL_TIME_START,
    p_end: ALL_TIME_END,
    p_basis: 'created',
    p_stages: null,
  })
  const row = data as LeadItemsRow | null
  for (const r of row?.rows ?? []) {
    const who = r.salesperson?.trim()
    if (who) out.add(personKey(who))
  }
  return out
}
