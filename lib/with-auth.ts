import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'

type AuthedHandler = (
  request: Request,
  context: { user: User; params?: Promise<Record<string, string>> }
) => Promise<NextResponse>

export function withAuth(handler: AuthedHandler) {
  return async (request: Request, { params }: { params?: Promise<Record<string, string>> } = {}) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return handler(request, { user, params })
  }
}
