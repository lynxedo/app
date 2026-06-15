import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const GUSTO_API = 'https://api.gusto.com'
const COMPANY_UUID = '2482737f-6211-430e-91f0-8a9726ae53d9'

type GustoEmployee = {
  uuid: string
  first_name: string
  last_name: string
  preferred_first_name?: string
  email: string
  phone?: string
  department?: string
  terminated: boolean
  jobs?: Array<{
    title?: string
    compensations?: Array<{
      rate: string
      payment_unit: string
      flsa_status: string
    }>
  }>
}

type DerivedComp = {
  payType: 'hourly' | 'salary'
  rate: number | null
  flsa: string | null
  title: string | null
}

// Single source of truth for turning a Gusto employee record into the fields we
// store. Used by BOTH the preview (GET) and the apply (POST) so the two paths
// can never derive a different pay rate from the same record.
function deriveGustoComp(ge: GustoEmployee): DerivedComp {
  const job = ge.jobs?.[0]
  const comp = job?.compensations?.[0]
  const payType: 'hourly' | 'salary' = comp?.payment_unit === 'Hour' ? 'hourly' : 'salary'
  const rate = payType === 'hourly' ? (parseFloat(comp?.rate ?? '0') || null) : null
  return { payType, rate, flsa: comp?.flsa_status ?? null, title: job?.title ?? null }
}

async function fetchGustoEmployees(token: string): Promise<GustoEmployee[]> {
  const res = await fetch(
    `${GUSTO_API}/v1/companies/${COMPANY_UUID}/employees?terminated=false`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  )
  if (!res.ok) {
    throw new Error(`Gusto API error: ${res.status} ${res.statusText}`)
  }
  return await res.json() as GustoEmployee[]
}

// GET — preview diff between Gusto and our DB (no changes applied)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const token = process.env.GUSTO_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({
      configured: false,
      message: 'Add GUSTO_ACCESS_TOKEN to .env.local to enable Gusto sync. Get your token from the Gusto Developer Console, or it will be set automatically when Gusto OAuth is connected in Phase 2.',
    })
  }

  // Fetch active employees from Gusto
  let gustoEmployees: GustoEmployee[]
  try {
    gustoEmployees = await fetchGustoEmployees(token)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gusto API error' }, { status: 502 })
  }

  // Fetch our current employees
  const { data: dbEmployees } = await supabase.from('employees').select('*')
  const dbMap = new Map((dbEmployees ?? []).map(e => [e.gusto_uuid, e]))

  const changes: Record<string, unknown>[] = []

  // Check Gusto → DB
  for (const ge of gustoEmployees) {
    const job = ge.jobs?.[0]
    const { payType, rate: newRate, flsa: flsaStatus } = deriveGustoComp(ge)
    const dbEmp = dbMap.get(ge.uuid)

    if (!dbEmp) {
      changes.push({
        key: `add_${ge.uuid}`,
        action: 'add',
        gusto_uuid: ge.uuid,
        gusto_job_uuid: job ? undefined : null,
        first_name: ge.first_name,
        last_name: ge.last_name,
        preferred_name: ge.preferred_first_name ?? null,
        email: ge.email,
        phone: ge.phone ?? null,
        department: ge.department ?? null,
        job_title: job?.title ?? null,
        pay_type: payType,
        flsa_status: flsaStatus,
        new_rate: newRate,
        label: `${ge.first_name} ${ge.last_name}`,
        detail: newRate ? `${payType} · $${newRate}/hr` : payType,
      })
    } else {
      // Check rate change for hourly employees
      if (payType === 'hourly' && newRate !== null) {
        const oldRate = dbEmp.hourly_rate ? parseFloat(dbEmp.hourly_rate) : 0
        if (Math.abs(oldRate - newRate) > 0.001) {
          changes.push({
            key: `rate_${ge.uuid}`,
            action: 'update_rate',
            id: dbEmp.id,
            gusto_uuid: ge.uuid,
            old_rate: oldRate,
            new_rate: newRate,
            label: `${ge.first_name} ${ge.last_name}`,
            detail: `$${oldRate.toFixed(2)} → $${newRate.toFixed(2)}/hr`,
          })
        }
      }
      // Check name/title changes
      const gustoTitle = job?.title ?? null
      if (gustoTitle && gustoTitle !== dbEmp.job_title) {
        changes.push({
          key: `title_${ge.uuid}`,
          action: 'update_title',
          id: dbEmp.id,
          gusto_uuid: ge.uuid,
          old_title: dbEmp.job_title,
          new_title: gustoTitle,
          label: `${ge.first_name} ${ge.last_name}`,
          detail: `"${dbEmp.job_title}" → "${gustoTitle}"`,
        })
      }
    }
  }

  // Check DB → Gusto (employees in DB but not in Gusto = possibly terminated)
  const gustoUuids = new Set(gustoEmployees.map(e => e.uuid))
  for (const dbEmp of (dbEmployees ?? []).filter(e => e.is_active)) {
    if (!gustoUuids.has(dbEmp.gusto_uuid)) {
      changes.push({
        key: `deactivate_${dbEmp.gusto_uuid}`,
        action: 'deactivate',
        id: dbEmp.id,
        gusto_uuid: dbEmp.gusto_uuid,
        label: `${dbEmp.first_name} ${dbEmp.last_name}`,
        detail: 'No longer active in Gusto',
      })
    }
  }

  return NextResponse.json({ configured: true, changes })
}

// POST — apply selected changes.
//
// TS9 (audit) — pay rates, titles, and pay type are NEVER trusted from the
// request body. The client only tells us WHICH employee (gusto_uuid) and what
// action to take; the actual values are re-fetched live from Gusto here and
// re-derived server-side. This closes the hole where an admin could POST an
// inflated `new_rate` that never came from Gusto. Any mismatch between what the
// client claimed and what Gusto actually says is logged.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { changes } = await req.json()
  if (!Array.isArray(changes)) return NextResponse.json({ error: 'changes array required' }, { status: 400 })

  // Any action that writes Gusto-sourced values (rate/title/pay type) must be
  // validated against live Gusto data. Deactivations don't need it.
  const needsGusto = changes.some(c => c.action === 'add' || c.action === 'update_rate' || c.action === 'update_title')

  const gustoByUuid = new Map<string, DerivedComp & { ge: GustoEmployee }>()
  if (needsGusto) {
    const token = process.env.GUSTO_ACCESS_TOKEN
    if (!token) {
      return NextResponse.json({ error: 'Gusto is not configured — cannot verify pay rates. Set GUSTO_ACCESS_TOKEN.' }, { status: 400 })
    }
    let gustoEmployees: GustoEmployee[]
    try {
      gustoEmployees = await fetchGustoEmployees(token)
    } catch (e) {
      // Refuse to apply rate/title changes we can't verify against Gusto.
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Gusto API error' }, { status: 502 })
    }
    for (const ge of gustoEmployees) {
      gustoByUuid.set(ge.uuid, { ...deriveGustoComp(ge), ge })
    }
  }

  const results = { added: 0, updated: 0, deactivated: 0, errors: [] as string[] }

  for (const change of changes) {
    try {
      if (change.action === 'add') {
        const g = gustoByUuid.get(change.gusto_uuid)
        if (!g) {
          results.errors.push(`${change.label}: not found in Gusto — skipped`)
          continue
        }
        // Authoritative values come from Gusto, not the request body.
        await supabase.from('employees').upsert({
          gusto_uuid: g.ge.uuid,
          first_name: g.ge.first_name,
          last_name: g.ge.last_name,
          preferred_name: g.ge.preferred_first_name ?? null,
          email: g.ge.email,
          phone: g.ge.phone ?? null,
          department: g.ge.department ?? null,
          job_title: g.title,
          pay_type: g.payType,
          flsa_status: g.flsa,
          hourly_rate: g.rate,
          is_active: true,
          gusto_synced_at: new Date().toISOString(),
        }, { onConflict: 'gusto_uuid' })
        results.added++
      } else if (change.action === 'update_rate') {
        const g = gustoByUuid.get(change.gusto_uuid)
        if (!g || g.payType !== 'hourly' || g.rate === null) {
          results.errors.push(`${change.label}: no current hourly rate in Gusto — skipped`)
          continue
        }
        const claimed = typeof change.new_rate === 'number' ? change.new_rate : null
        if (claimed !== null && Math.abs(claimed - g.rate) > 0.001) {
          console.warn(
            `[gusto-import] rate mismatch for ${change.gusto_uuid} (${change.label}): ` +
            `request claimed $${claimed}, Gusto says $${g.rate} — applying Gusto value`
          )
        }
        await supabase.from('employees').update({
          hourly_rate: g.rate, // server-fetched, never the client value
          gusto_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', change.id)
        results.updated++
      } else if (change.action === 'update_title') {
        const g = gustoByUuid.get(change.gusto_uuid)
        if (!g || !g.title) {
          results.errors.push(`${change.label}: no current title in Gusto — skipped`)
          continue
        }
        await supabase.from('employees').update({
          job_title: g.title, // server-fetched
          gusto_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', change.id)
        results.updated++
      } else if (change.action === 'deactivate') {
        await supabase.from('employees').update({
          is_active: false,
          updated_at: new Date().toISOString(),
        }).eq('id', change.id)
        results.deactivated++
      }
    } catch (e) {
      results.errors.push(`${change.label}: ${e}`)
    }
  }

  return NextResponse.json({ ok: true, results })
}
