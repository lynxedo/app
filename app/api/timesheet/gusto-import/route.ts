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
  const gustoRes = await fetch(
    `${GUSTO_API}/v1/companies/${COMPANY_UUID}/employees?terminated=false`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  )

  if (!gustoRes.ok) {
    return NextResponse.json({ error: `Gusto API error: ${gustoRes.status} ${gustoRes.statusText}` }, { status: 502 })
  }

  const gustoEmployees: GustoEmployee[] = await gustoRes.json()

  // Fetch our current employees
  const { data: dbEmployees } = await supabase.from('employees').select('*')
  const dbMap = new Map((dbEmployees ?? []).map(e => [e.gusto_uuid, e]))

  const changes: Record<string, unknown>[] = []

  // Check Gusto → DB
  for (const ge of gustoEmployees) {
    const job = ge.jobs?.[0]
    const comp = job?.compensations?.[0]
    const payType = comp?.payment_unit === 'Hour' ? 'hourly' : 'salary'
    const newRate = payType === 'hourly' ? parseFloat(comp?.rate ?? '0') || null : null
    const flsaStatus = comp?.flsa_status ?? null
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

// POST — apply selected changes
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

  const results = { added: 0, updated: 0, deactivated: 0, errors: [] as string[] }

  for (const change of changes) {
    try {
      if (change.action === 'add') {
        await supabase.from('employees').upsert({
          gusto_uuid: change.gusto_uuid,
          first_name: change.first_name,
          last_name: change.last_name,
          preferred_name: change.preferred_name,
          email: change.email,
          phone: change.phone,
          department: change.department,
          job_title: change.job_title,
          pay_type: change.pay_type,
          flsa_status: change.flsa_status,
          hourly_rate: change.new_rate,
          is_active: true,
          gusto_synced_at: new Date().toISOString(),
        }, { onConflict: 'gusto_uuid' })
        results.added++
      } else if (change.action === 'update_rate') {
        await supabase.from('employees').update({
          hourly_rate: change.new_rate,
          gusto_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', change.id)
        results.updated++
      } else if (change.action === 'update_title') {
        await supabase.from('employees').update({
          job_title: change.new_title,
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
