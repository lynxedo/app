import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const { searchParams } = new URL(request.url)
  const reason = searchParams.get('reason') ?? ''
  return NextResponse.redirect(`${APP_URL}/login${reason ? `?error=${reason}` : ''}`)
}
