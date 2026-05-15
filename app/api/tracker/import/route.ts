import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const GROUP_TO_STAGE: Record<string, string> = {
  'leads - current': 'current',
  'current': 'current',
  'appointment set': 'appointment_set',
  'follow up - long term': 'follow_up_long_term',
  'follow up — long term': 'follow_up_long_term',
  'closed won': 'closed_won',
  'upsells': 'upsells',
  'closed lost': 'closed_lost',
  'closed other': 'closed_other',
  'saves': 'saves',
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '').slice(-10)
}

function parseDate(raw: string): string | null {
  if (!raw?.trim()) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function parseNumber(raw: string): number | null {
  if (!raw?.trim()) return null
  const n = parseFloat(raw.replace(/[$,]/g, ''))
  return isNaN(n) ? null : n
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const { rows } = await request.json() as { rows: Record<string, string>[] }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Fetch all existing phones for this company to deduplicate
  const { data: existing } = await admin
    .from('leads')
    .select('phone')
    .eq('company_id', profile.company_id)

  const existingPhones = new Set((existing ?? []).map(r => normalizePhone(r.phone ?? '')).filter(Boolean))

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowLabel = `Row ${i + 2}`

    try {
      const rawPhone = row['Phone Number'] ?? ''
      const phone = normalizePhone(rawPhone)

      if (phone && existingPhones.has(phone)) {
        skipped++
        continue
      }

      const groupRaw = (row['Group'] ?? '').toLowerCase().trim()
      const stage = GROUP_TO_STAGE[groupRaw] ?? 'current'

      // Parse service / auxiliary as arrays (may be comma-separated)
      const serviceRaw = row['Service'] ?? ''
      const auxRaw = row['Auxiliary Services'] ?? ''
      const service = serviceRaw ? serviceRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : []
      const auxiliary_services = auxRaw ? auxRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : []

      const lead = {
        company_id: profile.company_id,
        first_name: row['First Name'] ?? null,
        last_name: row['Last Name'] ?? null,
        phone: phone || null,
        email: row['Email Address'] || null,
        service: service.length ? service : null,
        lead_source: row['Lead Source'] || null,
        status: row['Status'] || null,
        stage,
        lead_creation_date: parseDate(row['Lead Creation Date']),
        sold_date: parseDate(row['Sold Date']),
        salesperson: row['Salesperson'] || null,
        base_program_sold: row['Base Program Sold'] || null,
        auxiliary_services: auxiliary_services.length ? auxiliary_services : null,
        annual_value: parseNumber(row['Annual Value']),
        service_address: row['Service Address'] || null,
      }

      const { data: newLead, error: insertError } = await admin
        .from('leads')
        .insert(lead)
        .select('id')
        .single()

      if (insertError) {
        errors.push(`${rowLabel}: ${insertError.message}`)
        continue
      }

      if (phone) existingPhones.add(phone)

      // Import Lead Comments as first note
      const comment = row['Lead Comments']?.trim()
      if (comment && newLead) {
        await admin.from('lead_notes').insert({
          lead_id: newLead.id,
          company_id: profile.company_id,
          note: comment,
          created_by: 'Monday Import',
        })
      }

      imported++
    } catch (err) {
      errors.push(`${rowLabel}: ${String(err)}`)
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}
