import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  return profile?.role === 'admin' ? { user, company_id: profile.company_id } : null
}

// POST — link an existing Lynxedo user to this roster employee
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin_ctx = await requireAdmin()
  if (!admin_ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { user_id } = await request.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const admin = createAdminClient()

  const { error } = await admin
    .from('employees')
    .update({ user_id })
    .eq('id', id)
    .eq('company_id', admin_ctx.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
