import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { IRRIGATION_TEMPLATE } from '@/lib/forms'

export const dynamic = 'force-dynamic'

async function requireFormsAdmin() {
  const check = await requireAdminArea('forms')
  if (!check.ok || !check.company_id || !check.user) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id, userId: check.user.id }
}

export async function GET() {
  const ctx = await requireFormsAdmin()
  if ('error' in ctx) return ctx.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('forms')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ forms: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await requireFormsAdmin()
  if ('error' in ctx) return ctx.error

  let body: { template?: string; name?: string } = {}
  try { body = await request.json() } catch {}

  const admin = createAdminClient()
  let insertData: Record<string, unknown>

  if (body.template === 'irrigation') {
    insertData = {
      company_id: ctx.companyId,
      created_by: ctx.userId,
      ...IRRIGATION_TEMPLATE,
    }
  } else {
    insertData = {
      company_id: ctx.companyId,
      created_by: ctx.userId,
      name: body.name ?? 'New Form',
      description: null,
      fields: [],
      notification_sms_template: null,
      active: true,
    }
  }

  const { data, error } = await admin
    .from('forms')
    .insert(insertData)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ form: data }, { status: 201 })
}
