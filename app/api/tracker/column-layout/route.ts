import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type LayoutEntry = { id: string; width: number; hidden?: boolean }

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { layout?: LayoutEntry[] } | null
  if (!body || !Array.isArray(body.layout)) {
    return NextResponse.json({ error: 'layout must be an array' }, { status: 400 })
  }

  const sanitized: LayoutEntry[] = []
  for (const entry of body.layout) {
    if (!entry || typeof entry.id !== 'string') continue
    const w = Number(entry.width)
    if (!Number.isFinite(w)) continue
    const out: LayoutEntry = { id: entry.id, width: Math.max(50, Math.min(600, Math.round(w))) }
    if (entry.hidden === true) out.hidden = true
    sanitized.push(out)
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ tracker_column_layout: sanitized })
    .eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
