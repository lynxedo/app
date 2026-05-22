import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Temporary diagnostic endpoint — receives client log lines and prints
// them to the server console so they show up in `pm2 logs lynxedo`.
// Used while debugging iOS APNs registration without a USB cable to read
// the Xcode device console. Delete once iOS push is confirmed working.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const who = user?.email ?? 'anon'

  let body: { tag?: string; message?: string; data?: unknown } = {}
  try { body = await request.json() } catch { /* ignore parse */ }

  const tag = body.tag ?? 'client'
  const message = body.message ?? ''
  const data = body.data !== undefined ? JSON.stringify(body.data) : ''

  console.log(`[debug-log] [${who}] [${tag}] ${message}${data ? ' :: ' + data : ''}`)

  return NextResponse.json({ ok: true })
}
