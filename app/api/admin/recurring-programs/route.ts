import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Admin-only: the recurring PROGRAM definitions the book is built from.
//
// ⚠⚠ WHY THIS ROUTE EXISTS. `recurring_program_definitions` decides three things and
// had no screen at all: whether a Jobber line item counts as recurring revenue, whether
// it is a base program or an add-on, and how many times a year it is charged. Every
// correction had to be a database session, and two of them were wrong for weeks —
// `PW 2x Week` said 104 charges when each job is invoiced 52 times, overstating the Pet
// Waste book by $12,388.48, and Mosquito reads $0 because its three programs have no
// cadence at all. Neither was visible anywhere in the product.
//
// `recurring_program_definitions` is company-scoped with RLS, but the write path is
// service-role through this route so the company can never come from the request.
async function getAdminContext(): Promise<{ company: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'admin' || !profile.company_id) return null
  return { company: profile.company_id as string }
}

export async function POST(request: Request) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const id = body.id ? String(body.id) : null
  const lineItemName = String(body.line_item_name || '').trim()
  const displayName = String(body.display_name || '').trim()
  const deptPrefix = String(body.dept_prefix || '').trim().toUpperCase()
  const isAuxiliary = body.is_auxiliary === true

  if (!lineItemName) return NextResponse.json({ error: 'Pick the Jobber line item' }, { status: 400 })
  if (!displayName) return NextResponse.json({ error: 'Give the program a name' }, { status: 400 })
  if (!deptPrefix) return NextResponse.json({ error: 'Pick the service line' }, { status: 400 })

  // ⚠ ROUNDS, not visits. A round can span consecutive days on a large property and the
  // second day bills $0.00, which is why Lawn Health Basic shows 16 visits against a
  // correct 8. The column is named visits_per_year for history; the number is rounds.
  let roundsPerYear: number | null = null
  if (isAuxiliary) {
    // An add-on rides its base program's schedule, so a cadence of its own would be a
    // second source of truth for the same thing. Held null deliberately.
    roundsPerYear = null
  } else {
    const raw = body.rounds_per_year
    if (raw === undefined || raw === null || raw === '') {
      // ⚠ Required for a base program. A null cadence does not fail loudly — the job
      // silently prices at $0 and the book quietly understates. That is exactly how
      // Mosquito came to report $0 across 10 jobs.
      return NextResponse.json(
        { error: 'How many times a year is this charged? A program with no number prices at $0.' },
        { status: 400 },
      )
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 366) {
      return NextResponse.json({ error: 'Rounds per year must be a whole number from 1 to 366' }, { status: 400 })
    }
    roundsPerYear = n
  }

  const admin = createAdminClient()
  const row = {
    company_id: ctx.company,
    line_item_name: lineItemName,
    display_name: displayName,
    dept_prefix: deptPrefix,
    is_auxiliary: isAuxiliary,
    visits_per_year: roundsPerYear,
    is_recurring: true,
  }

  if (id) {
    const { error } = await admin
      .from('recurring_program_definitions')
      .update(row)
      .eq('id', id)
      .eq('company_id', ctx.company)   // scoped, so an id from elsewhere cannot be edited
    if (error) {
      // 23505 = the per-company unique on line_item_name.
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `“${lineItemName}” is already set up as a program` }, { status: 409 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  const { error } = await admin.from('recurring_program_definitions').insert(row)
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `“${lineItemName}” is already set up as a program` }, { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('recurring_program_definitions')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.company)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
