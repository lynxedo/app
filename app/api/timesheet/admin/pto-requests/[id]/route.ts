import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH /api/timesheet/admin/pto-requests/[id] — approve or reject
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()

  if (!(profile?.role === 'admin' || profile?.can_admin_timesheet)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { action, admin_note } = body

  if (!['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('pto_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      admin_note: admin_note?.trim() || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data })
}
