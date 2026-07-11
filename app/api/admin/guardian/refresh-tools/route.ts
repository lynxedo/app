import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { bustToolsCache } from '@/lib/hub-claude'

export const dynamic = 'force-dynamic'

export async function POST() {
  const check = await requireAdminArea('ai')
  if (!check.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  bustToolsCache()
  return NextResponse.json({ ok: true })
}
